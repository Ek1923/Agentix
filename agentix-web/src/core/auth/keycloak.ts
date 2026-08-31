import { readIdentityConfig, realmUrl, type IdentityConfig } from '../sync/identity'
import type { AuthFailure, Session } from './index'

/**
 * Signing in against the organisation's own Keycloak.
 *
 * This is route A of the two-backend split: Keycloak signs the token, and every
 * member's Supabase verifies it with the realm's public key. Nothing secret is
 * ever copied between the organisation's server and somebody's project — the
 * public half is enough to check a signature, and only the server can produce one.
 *
 * The flow is **authorization code with PKCE**, which is what a public client
 * without a secret is supposed to use. A browser app cannot keep a client secret;
 * PKCE replaces it with a one-time proof that the app which started the sign-in is
 * the one redeeming the code, so an intercepted code is worth nothing on its own.
 *
 * Written against the endpoints directly rather than through `keycloak-js`: this
 * needs an authorize URL, one token exchange and a refresh, and the adapter ships
 * an iframe-based session monitor and a silent-renew scheme to provide them.
 *
 * The session lives in `localStorage` on this device and is never synced. It is
 * this browser's proof, not the person's data — syncing it would hand another
 * device a live token.
 */

/** The public client registered in the realm. See SERVER-SETUP.md §8. */
export const CLIENT_ID = 'agentix-web'

const SESSION_KEY = 'agentix-identity-session'
/** Where the one-time PKCE proof waits while the browser is away at Keycloak. */
const PENDING_KEY = 'agentix-identity-pending'

/** Refresh this long before expiry, so a sync never starts on a dying token. */
const REFRESH_MARGIN_SECONDS = 60

export interface IdentitySession extends Session {
  /** Kept so signing out can end the session on the server, not just here. */
  idToken: string | null
}

export type IdentityOutcome =
  | { status: 'none' }
  | { status: 'signed-in'; session: IdentitySession }
  | { status: 'failed'; message: string; failure: AuthFailure }

/**
 * An outcome from something that actually ran. Only picking up a redirect can
 * answer "nothing happened"; a token exchange always lands one way or the other,
 * and saying so in the type is what lets its callers read `failure` without a
 * check that could never be true.
 */
type Settled = Exclude<IdentityOutcome, { status: 'none' }>

/* ── Storage ────────────────────────────────────────────────────────────────── */

export function loadIdentitySession(): IdentitySession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw === null ? null : (JSON.parse(raw) as IdentitySession)
  } catch {
    return null
  }
}

export function saveIdentitySession(session: IdentitySession | null): void {
  try {
    if (session === null) localStorage.removeItem(SESSION_KEY)
    else localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Blocked storage: signing in does not survive a reload. Degrade, do not fail.
  }
}

export function isExpired(session: Session, nowSeconds = Date.now() / 1000): boolean {
  return session.expiresAt - REFRESH_MARGIN_SECONDS <= nowSeconds
}

/* ── PKCE ───────────────────────────────────────────────────────────────────── */

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 32 random bytes, which is comfortably inside the spec's 43–128 character range. */
function randomString(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

/**
 * The S256 challenge for a verifier.
 *
 * If the platform has no WebCrypto this throws rather than falling back to the
 * `plain` method the spec also allows. A silent downgrade would send the verifier
 * itself in the first request, which is exactly the interception PKCE exists to
 * survive — and it would look like it worked.
 */
async function challengeFor(verifier: string): Promise<string> {
  if (typeof crypto === 'undefined' || crypto.subtle === undefined) {
    throw new Error('This browser cannot sign in securely: no WebCrypto available.')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

/**
 * Where Keycloak sends the browser back to.
 *
 * Origin and path only. The path matters because the app is served from `/`
 * behind a custom domain and from `/<repo>/` on a project page, and the redirect
 * URI has to match one the realm was told about exactly. The hash is dropped: the
 * router owns it, and Keycloak appends its answer to the query.
 */
export function redirectTarget(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}`
}

/* ── Starting ───────────────────────────────────────────────────────────────── */

/**
 * Builds the authorize URL and remembers the proof that goes with it.
 *
 * `state` is kept alongside the verifier and checked on the way back: it is what
 * makes a code that arrives unasked — someone else's, or a forged link — fail
 * instead of signing this browser into an account it did not ask for.
 */
export async function authorizeUrl(config = readIdentityConfig()): Promise<string | null> {
  if (config === null) return null

  const verifier = randomString()
  const state = randomString()
  const challenge = await challengeFor(verifier)

  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state }))
  } catch {
    // Without somewhere to keep the proof the exchange cannot be completed, and
    // sending someone to a login that cannot finish is worse than not starting.
    return null
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: redirectTarget(),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })

  return `${realmUrl(config)}/protocol/openid-connect/auth?${params.toString()}`
}

/**
 * Leaves the app for the login page.
 *
 * A full-page redirect rather than a popup: popups are blocked by default on iOS
 * Safari and inside a WebView, which are two of the three platforms this ships on.
 */
export async function signIn(): Promise<boolean> {
  const url = await authorizeUrl()
  if (url === null) return false

  window.location.assign(url)
  return true
}

/* ── Coming back ────────────────────────────────────────────────────────────── */

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  error_description?: string
  error?: string
}

/**
 * Reads the `sub` and `email` out of a token without verifying it.
 *
 * Safe only because nothing here trusts them: the server checks the signature on
 * every request, and these two values are used to label the session and stamp
 * rows. A client that decided its own permissions from an unverified payload
 * would be a different matter entirely.
 */
function claimsOf(token: string): { sub: string; email: string } {
  try {
    const payload = token.split('.')[1]
    if (payload === undefined) return { sub: '', email: '' }
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const claims = JSON.parse(json) as { sub?: string; email?: string }
    return { sub: claims.sub ?? '', email: claims.email ?? '' }
  } catch {
    return { sub: '', email: '' }
  }
}

function sessionFrom(tokens: TokenResponse): IdentitySession | null {
  if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
    return null
  }
  const { sub, email } = claimsOf(tokens.access_token)
  if (sub === '') return null

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token ?? null,
    expiresAt: Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 300),
    userId: sub,
    email,
  }
}

async function exchange(config: IdentityConfig, body: URLSearchParams): Promise<Settled> {
  let response: Response
  try {
    response = await fetch(`${realmUrl(config)}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    // The caught error is dropped on purpose: a fetch failure can carry the
    // request, and the request carries the code or the refresh token.
    return {
      status: 'failed',
      failure: 'unreachable',
      message: 'Could not reach the organisation server. Your work is saved here.',
    }
  }

  const tokens = (await response.json().catch(() => ({}))) as TokenResponse
  if (!response.ok) {
    return {
      status: 'failed',
      failure: 'rejected',
      // Keycloak's description is written for a person; its `error` code is not.
      message: tokens.error_description ?? 'The organisation server refused the sign-in.',
    }
  }

  const session = sessionFrom(tokens)
  if (session === null) {
    return {
      status: 'failed',
      failure: 'rejected',
      message: 'The organisation server sent a sign-in that could not be read.',
    }
  }
  return { status: 'signed-in', session }
}

/**
 * Picks up what Keycloak left in the URL on the way back.
 *
 * The query is scrubbed before anything else happens: an authorization code is
 * one-time but not harmless, and leaving it parked in the address bar and in the
 * browser's history is how it ends up in a screenshot or a shared link.
 *
 * Runs before the app renders — main.tsx calls it — so nothing is drawn against a
 * session that is one round trip from existing.
 */
export async function consumeRedirect(): Promise<IdentityOutcome> {
  if (typeof window === 'undefined') return { status: 'none' }

  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const error = params.get('error')
  if (code === null && error === null) return { status: 'none' }

  window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)

  let pending: { verifier?: string; state?: string } = {}
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (raw !== null) pending = JSON.parse(raw) as { verifier?: string; state?: string }
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // Nothing pending. Handled by the state check below.
  }

  if (error !== null) {
    return {
      status: 'failed',
      failure: 'rejected',
      message: params.get('error_description') ?? 'The sign-in was refused.',
    }
  }

  if (pending.state === undefined || pending.state !== state) {
    return {
      status: 'failed',
      failure: 'rejected',
      message: 'That sign-in did not start here. Try again from this device.',
    }
  }

  const config = readIdentityConfig()
  if (config === null || pending.verifier === undefined || code === null) {
    return {
      status: 'failed',
      failure: 'unconfigured',
      message: 'No organisation server is set up on this device.',
    }
  }

  const outcome = await exchange(
    config,
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectTarget(),
      code_verifier: pending.verifier,
    }),
  )

  if (outcome.status === 'signed-in') saveIdentitySession(outcome.session)
  return outcome
}

/* ── Keeping it alive ───────────────────────────────────────────────────────── */

/**
 * Trades a refresh token for a fresh session.
 *
 * A rejected refresh signs the device out; an unreachable server does not. That
 * distinction is the whole point: being offline is not a reason to lock somebody
 * out of a database that lives on their own machine.
 */
export async function refresh(session: IdentitySession): Promise<Settled> {
  const config = readIdentityConfig()
  if (config === null) {
    return {
      status: 'failed',
      failure: 'unconfigured',
      message: 'No organisation server is set up on this device.',
    }
  }

  const outcome = await exchange(
    config,
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: session.refreshToken,
    }),
  )

  if (outcome.status === 'signed-in') saveIdentitySession(outcome.session)
  else if (outcome.failure === 'rejected') saveIdentitySession(null)
  return outcome
}

/**
 * The session to use right now, refreshed if it is about to expire.
 *
 * Returns null only when there is nothing usable. A session that could not be
 * refreshed because the server was unreachable is still returned: the token may
 * have minutes left on it, and the request that follows will say so far more
 * honestly than a pre-emptive sign-out would.
 */
export async function currentSession(): Promise<IdentitySession | null> {
  const stored = loadIdentitySession()
  if (stored === null) return null
  if (!isExpired(stored)) return stored

  const outcome = await refresh(stored)
  if (outcome.status === 'signed-in') return outcome.session
  return outcome.failure === 'unreachable' ? stored : null
}

/**
 * Signs out here, and asks Keycloak to end the session there.
 *
 * Local first, deliberately. If the round trip fails, this device is still signed
 * out — the opposite order leaves someone looking at a sign-out that did nothing.
 */
export function signOut(): string | null {
  const session = loadIdentitySession()
  const config = readIdentityConfig()
  saveIdentitySession(null)

  if (config === null || session?.idToken == null) return null

  const params = new URLSearchParams({
    id_token_hint: session.idToken,
    post_logout_redirect_uri: redirectTarget(),
  })
  return `${realmUrl(config)}/protocol/openid-connect/logout?${params.toString()}`
}
