// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveIdentityUrl } from '../sync/identity'
import {
  authorizeUrl,
  consumeRedirect,
  currentSession,
  loadIdentitySession,
  refresh,
  saveIdentitySession,
  signOut,
  type IdentitySession,
} from './keycloak'

/*
  jsdom ships getRandomValues but not the subtle crypto PKCE needs, so the real
  implementation from Node is lent to it. The alternative — mocking the digest —
  would test that the code calls something, rather than that the challenge it
  produces is the hash of the verifier it kept.
*/
if (globalThis.crypto.subtle === undefined) {
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: webcrypto.subtle,
    configurable: true,
  })
}

/** A token whose payload the client reads for `sub` and `email`, unverified. */
function jwt(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_')
  return `header.${payload}.signature`
}

const TOKENS = {
  access_token: jwt({ sub: '11111111-2222-3333-4444-555555555555', email: 'ege@example.com' }),
  refresh_token: 'refresh-1',
  id_token: 'id-1',
  expires_in: 300,
}

function tokenResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function at(url: string) {
  window.history.replaceState({}, '', url)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  at('/Agentix/')
  saveIdentityUrl('https://id.example.com')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('starting a sign-in', () => {
  it('asks for a code with an S256 challenge, not the verifier itself', async () => {
    const url = new URL((await authorizeUrl())!)

    expect(url.origin + url.pathname).toBe(
      'https://id.example.com/realms/agentix/protocol/openid-connect/auth',
    )
    expect(url.searchParams.get('client_id')).toBe('agentix-web')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')

    const pending = JSON.parse(sessionStorage.getItem('agentix-identity-pending')!)
    expect(url.searchParams.get('code_challenge')).not.toBe(pending.verifier)
    expect(url.searchParams.get('state')).toBe(pending.state)
  })

  it('comes back to the path the app is served from, which the realm has to match', async () => {
    const url = new URL((await authorizeUrl())!)

    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/Agentix/')
  })

  it('does not start at all without a server to sign in to', async () => {
    saveIdentityUrl(null)

    expect(await authorizeUrl()).toBeNull()
    expect(sessionStorage.getItem('agentix-identity-pending')).toBeNull()
  })
})

describe('coming back', () => {
  it('does nothing when there is nothing in the URL', async () => {
    expect(await consumeRedirect()).toEqual({ status: 'none' })
  })

  it('trades the code for a session and scrubs it out of the address bar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse(TOKENS))
    vi.stubGlobal('fetch', fetchMock)

    await authorizeUrl()
    const state = JSON.parse(sessionStorage.getItem('agentix-identity-pending')!).state
    at(`/Agentix/?code=the-code&state=${encodeURIComponent(state)}#/settings`)

    const outcome = await consumeRedirect()

    expect(outcome.status).toBe('signed-in')
    expect(loadIdentitySession()?.userId).toBe('11111111-2222-3333-4444-555555555555')
    expect(loadIdentitySession()?.email).toBe('ege@example.com')

    // The code is one-time, but parking it in history is how it ends up shared.
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('#/settings')

    const body = fetchMock.mock.calls[0]![1].body as URLSearchParams
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code_verifier')).toEqual(expect.any(String))
    // The proof is one-time too.
    expect(sessionStorage.getItem('agentix-identity-pending')).toBeNull()
  })

  it('refuses a code that this browser never asked for', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await authorizeUrl()
    at('/Agentix/?code=someone-elses&state=not-the-one-we-sent')

    const outcome = await consumeRedirect()

    expect(outcome).toMatchObject({ status: 'failed', failure: 'rejected' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(loadIdentitySession()).toBeNull()
  })

  it('passes on what the server said when it refuses', async () => {
    vi.stubGlobal('fetch', vi.fn())
    at('/Agentix/?error=access_denied&error_description=You+are+not+on+this+roster')

    const outcome = await consumeRedirect()

    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'You are not on this roster',
    })
  })

  it('reports an unreachable server as unreachable, not as a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await authorizeUrl()
    const state = JSON.parse(sessionStorage.getItem('agentix-identity-pending')!).state
    at(`/Agentix/?code=the-code&state=${encodeURIComponent(state)}`)

    expect(await consumeRedirect()).toMatchObject({ status: 'failed', failure: 'unreachable' })
  })
})

describe('keeping the session alive', () => {
  const expired: IdentitySession = {
    accessToken: 'old',
    refreshToken: 'refresh-1',
    idToken: 'id-1',
    expiresAt: Math.floor(Date.now() / 1000) - 10,
    userId: 'u-1',
    email: 'ege@example.com',
  }

  it('refreshes a session that is about to expire', async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse(TOKENS))
    vi.stubGlobal('fetch', fetchMock)
    saveIdentitySession(expired)

    const session = await currentSession()

    expect(session?.accessToken).toBe(TOKENS.access_token)
    expect((fetchMock.mock.calls[0]![1].body as URLSearchParams).get('grant_type')).toBe(
      'refresh_token',
    )
  })

  it('signs out when the server actually rejects the refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(tokenResponse({ error: 'invalid_grant' }, 400)),
    )
    saveIdentitySession(expired)

    expect(await currentSession()).toBeNull()
    expect(loadIdentitySession()).toBeNull()
  })

  it('keeps the session when the server is merely unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    saveIdentitySession(expired)

    // Being on a train is not a reason to lock someone out of their own device.
    expect((await currentSession())?.refreshToken).toBe('refresh-1')
    expect(loadIdentitySession()).not.toBeNull()
  })

  it('leaves an unexpired session alone rather than spending a round trip', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    saveIdentitySession({ ...expired, expiresAt: Math.floor(Date.now() / 1000) + 3600 })

    await currentSession()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never lets a refresh failure quote the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('POST ...refresh_token=refresh-1')))

    const outcome = await refresh(expired)

    expect(outcome.status).toBe('failed')
    expect(JSON.stringify(outcome)).not.toContain('refresh-1')
  })
})

describe('signing out', () => {
  it('clears this device first, then offers to end the session on the server', () => {
    saveIdentitySession({
      accessToken: 'a',
      refreshToken: 'r',
      idToken: 'id-1',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      userId: 'u-1',
      email: 'ege@example.com',
    })

    const url = signOut()

    expect(loadIdentitySession()).toBeNull()
    expect(url).toContain('/protocol/openid-connect/logout')
    expect(url).toContain('id_token_hint=id-1')
  })

  it('is still a sign-out when there is nothing to tell the server', () => {
    expect(signOut()).toBeNull()
    expect(loadIdentitySession()).toBeNull()
  })
})
