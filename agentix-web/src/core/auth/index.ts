import { readSupabaseConfig } from '../sync/supabase'

/**
 * Authentication, over Supabase's GoTrue endpoints.
 *
 * The same reasoning as the sync transport: this needs sign-up, sign-in, refresh,
 * OAuth and sign-out, and pulling in a client library that also ships realtime and
 * storage to get them is a poor trade for a static, offline-first app.
 *
 * The session is deliberately kept out of the synced database — it belongs to
 * this device, and syncing it would hand another device your tokens.
 */

export interface Session {
  accessToken: string
  refreshToken: string
  /** Unix seconds. */
  expiresAt: number
  userId: string
  email: string
}

/**
 * Why a call did not succeed.
 *
 * The distinction is load-bearing, not bookkeeping: a rejected token means sign
 * out, and an unreachable server means keep going. Collapsing the two is how an
 * offline-first app locks someone out of their own local data on a train.
 */
export type AuthFailure = 'rejected' | 'unreachable' | 'unconfigured'

export interface AuthResult {
  ok: boolean
  message: string
  session?: Session
  failure?: AuthFailure
}

export type OAuthProvider = 'google' | 'apple' | 'github'

/*
  Order is the order they are offered.

  GitHub last because it is the narrowest audience — but it is the cheapest of the
  three to actually switch on: a free OAuth app, no cloud console project and no
  paid membership. For a developer tool it is often the first one that works.
*/
export const OAUTH_PROVIDERS: ReadonlyArray<{ id: OAuthProvider; label: string }> = [
  { id: 'google', label: 'Google' },
  { id: 'apple', label: 'Apple' },
  { id: 'github', label: 'GitHub' },
]

const SESSION_KEY = 'agentix-session'

/** Refresh this long before expiry, so a sync never starts on a dying token. */
const REFRESH_MARGIN_SECONDS = 60

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  user?: { id?: string; email?: string }
  error_description?: string
  msg?: string
}

function toSession(payload: TokenResponse): Session | null {
  if (
    typeof payload.access_token !== 'string' ||
    typeof payload.refresh_token !== 'string' ||
    typeof payload.user?.id !== 'string'
  ) {
    return null
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (payload.expires_in ?? 3600),
    userId: payload.user.id,
    email: payload.user.email ?? '',
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw === null ? null : (JSON.parse(raw) as Session)
  } catch {
    return null
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session === null) localStorage.removeItem(SESSION_KEY)
    else localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // A blocked storage means sign-in does not survive a reload. Worth degrading
    // over, not failing over.
  }
}

export function isExpired(session: Session, nowSeconds = Date.now() / 1000): boolean {
  return session.expiresAt - REFRESH_MARGIN_SECONDS <= nowSeconds
}

async function callAuth(path: string, body: unknown): Promise<AuthResult> {
  const config = readSupabaseConfig()
  if (config === null) {
    return {
      ok: false,
      failure: 'unconfigured',
      message: 'No sync server is set up yet.',
    }
  }

  let response: Response
  try {
    response = await fetch(`${config.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: config.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // Never forward the caught error: it can carry the request, and the request
    // carries the password.
    return { ok: false, failure: 'unreachable', message: 'Could not reach the server.' }
  }

  const payload = (await response.json().catch(() => ({}))) as TokenResponse

  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      return {
        ok: false,
        failure: 'rejected',
        message: 'That email and password did not match.',
      }
    }
    if (response.status === 422) {
      return {
        ok: false,
        failure: 'rejected',
        message: payload.msg ?? 'That email address was refused.',
      }
    }
    if (response.status === 429) {
      return {
        ok: false,
        failure: 'unreachable',
        message: 'Too many attempts. Try again shortly.',
      }
    }
    // A server error is not a verdict on the credentials.
    return {
      ok: false,
      failure: response.status >= 500 ? 'unreachable' : 'rejected',
      message: `Sign-in failed (HTTP ${response.status}).`,
    }
  }

  const session = toSession(payload)
  if (session === null) {
    // A successful sign-up with email confirmation on returns no tokens.
    return { ok: true, message: 'Check your email to confirm the account.' }
  }

  saveSession(session)
  return { ok: true, message: 'Signed in.', session }
}

export function signIn(email: string, password: string): Promise<AuthResult> {
  return callAuth('token?grant_type=password', { email, password })
}

export function signUp(email: string, password: string): Promise<AuthResult> {
  // `redirect_to` is a query parameter on this endpoint, not a body field, and it
  // is what brings a confirmation link back to the app instead of to Supabase's
  // own "email confirmed" page.
  const back = encodeURIComponent(redirectTarget())
  return callAuth(`signup?redirect_to=${back}`, { email, password })
}

export function signOut(): void {
  saveSession(null)
}

/**
 * Where an identity provider sends the browser back to.
 *
 * The pathname is kept because the app is served from `/` behind a custom domain
 * and from `/<repo>/` on a project page; dropping it lands the redirect on a 404.
 * The hash is dropped so the returning URL is clean before tokens are appended.
 */
export function redirectTarget(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}`
}

/** Where the browser goes to sign in with an identity provider. */
export function oauthUrl(provider: OAuthProvider): string | null {
  const config = readSupabaseConfig()
  if (config === null) return null

  const redirect = encodeURIComponent(redirectTarget())
  return `${config.url}/auth/v1/authorize?provider=${provider}&redirect_to=${redirect}`
}

/**
 * Starts the Google or Apple flow by leaving the app.
 *
 * A full-page redirect rather than a popup: popups are blocked by default on iOS
 * Safari and inside a WebView, which are two of the three platforms this ships on.
 */
export function signInWithProvider(provider: OAuthProvider): boolean {
  const url = oauthUrl(provider)
  if (url === null) return false

  window.location.assign(url)
  return true
}

/** What came back when the browser returned from Google or Apple. */
export type OAuthOutcome =
  | { status: 'none' }
  | { status: 'signed-in'; session: Session }
  | { status: 'failed'; message: string }

/**
 * Picks up what an identity provider left in the URL.
 *
 * Supabase returns the result in the fragment — `#access_token=…&refresh_token=…`
 * on success, `#error=…&error_description=…` on refusal. The fragment is scrubbed
 * before anything else happens: leaving it would park a live access token in the
 * browser's history and in the address bar, and would hand the hash router a route
 * it cannot parse.
 *
 * Runs before the app renders, which is why main.tsx calls it.
 */
export function consumeOAuthRedirect(): OAuthOutcome {
  if (typeof window === 'undefined') return { status: 'none' }

  const raw = window.location.hash.replace(/^#/, '')
  if (!raw.includes('access_token=') && !raw.includes('error=')) return { status: 'none' }

  const params = new URLSearchParams(raw)
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)

  const failure = params.get('error_description') ?? params.get('error')
  if (failure !== null) {
    // "access_denied" is someone tapping Cancel, not a fault worth alarming them over.
    const cancelled = /denied|cancel/i.test(failure)
    return { status: 'failed', message: cancelled ? 'Sign-in was cancelled.' : failure }
  }

  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const claims = readClaims(accessToken)

  if (accessToken === null || refreshToken === null || claims === null) {
    return { status: 'failed', message: 'That sign-in came back incomplete. Try again.' }
  }

  const lifetime = Number(params.get('expires_in'))
  const session: Session = {
    accessToken,
    refreshToken,
    expiresAt:
      Math.floor(Date.now() / 1000) + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600),
    userId: claims.sub,
    email: claims.email ?? '',
  }

  saveSession(session)
  return { status: 'signed-in', session }
}

/**
 * Reads `sub` and `email` out of a JWT payload.
 *
 * Decoding only — the signature is not checked and must not be trusted for
 * anything. The server verifies every request; this is purely to know which
 * account to show in the interface.
 */
function readClaims(token: string | null): { sub: string; email?: string } | null {
  if (token === null) return null
  try {
    const payload = token.split('.')[1]
    if (payload === undefined) return null

    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const claims = JSON.parse(json) as { sub?: string; email?: string }
    return typeof claims.sub === 'string' ? { sub: claims.sub, email: claims.email } : null
  } catch {
    return null
  }
}

/**
 * Exchanges a refresh token for a fresh one.
 *
 * Signs out only when the server actually rejected the token. An unreachable
 * server returns the existing session unchanged: being offline is not a reason
 * to lose access to a local database, and this app is offline-first by design.
 */
export async function refresh(session: Session): Promise<Session | null> {
  const result = await callAuth('token?grant_type=refresh_token', {
    refresh_token: session.refreshToken,
  })

  if (result.session !== undefined) return result.session

  if (result.failure === 'rejected') {
    signOut()
    return null
  }
  return session
}

/** The session to sync with, refreshed if it is close to expiring. */
export async function currentSession(): Promise<Session | null> {
  const session = loadSession()
  if (session === null) return null
  if (!isExpired(session)) return session
  return refresh(session)
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/** Supabase enforces six characters; saying so beats a server round trip. */
export function isValidPassword(value: string): boolean {
  return value.length >= 6
}
