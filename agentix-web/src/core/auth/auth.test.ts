// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumeOAuthRedirect,
  isExpired,
  isValidEmail,
  isValidPassword,
  loadSession,
  oauthUrl,
  refresh,
  saveSession,
  signIn,
  signOut,
  type Session,
} from './index'

const SESSION: Session = {
  accessToken: 'access-token-value',
  refreshToken: 'refresh-token-value',
  expiresAt: 4102444800, // 2100
  userId: 'user-1',
  email: 'someone@example.com',
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('validation', () => {
  it('accepts a real email and rejects a broken one', () => {
    expect(isValidEmail('someone@example.com')).toBe(true)
    expect(isValidEmail('  spaced@example.com  ')).toBe(true)
    expect(isValidEmail('no-at-sign')).toBe(false)
    expect(isValidEmail('missing@domain')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })

  it('enforces the six-character minimum before a round trip', () => {
    expect(isValidPassword('123456')).toBe(true)
    expect(isValidPassword('12345')).toBe(false)
  })
})

describe('the stored session', () => {
  it('round-trips', () => {
    saveSession(SESSION)
    expect(loadSession()).toEqual(SESSION)
  })

  it('signing out clears it', () => {
    saveSession(SESSION)
    signOut()
    expect(loadSession()).toBeNull()
  })

  it('survives corrupted storage rather than throwing', () => {
    localStorage.setItem('agentix-session', 'not json')
    expect(loadSession()).toBeNull()
  })
})

describe('isExpired', () => {
  it('is false while the token has real life left', () => {
    expect(isExpired({ ...SESSION, expiresAt: 2000 }, 1000)).toBe(false)
  })

  it('is true inside the refresh margin, before the token actually dies', () => {
    // Refreshing early means a sync never starts on a token about to expire.
    expect(isExpired({ ...SESSION, expiresAt: 1030 }, 1000)).toBe(true)
  })

  it('is true once it has passed', () => {
    expect(isExpired({ ...SESSION, expiresAt: 900 }, 1000)).toBe(true)
  })
})

describe('signIn', () => {
  it('refuses when no Supabase project is configured', async () => {
    // Asserted on the reason rather than the wording: the caller branches on
    // `failure`, and the sentence is free to be rewritten.
    const result = await signIn('someone@example.com', 'secret123')
    expect(result.ok).toBe(false)
    expect(result.failure).toBe('unconfigured')
  })

  it('stores the session on success', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: 'a',
              refresh_token: 'r',
              expires_in: 3600,
              user: { id: 'user-1', email: 'someone@example.com' },
            }),
            { status: 200 },
          ),
      ),
    )

    const result = await signIn('someone@example.com', 'secret123')

    expect(result.ok).toBe(true)
    expect(result.session?.userId).toBe('user-1')
    expect(loadSession()?.accessToken).toBe('a')
  })

  it('reports a rejected password without echoing it', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })))

    const result = await signIn('someone@example.com', 'hunter2-secret')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('That email and password did not match.')
    expect(result.message).not.toContain('hunter2')
  })

  it('never puts the password into a network-failure message', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect failed sending password=hunter2-secret')
      }),
    )

    const result = await signIn('someone@example.com', 'hunter2-secret')

    expect(result.message).toBe('Could not reach the server.')
    expect(result.message).not.toContain('hunter2')
  })

  it('reports an unconfirmed sign-up as success without a session', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ user: { id: 'u' } }), { status: 200 })),
    )

    const result = await signIn('someone@example.com', 'secret123')
    expect(result.ok).toBe(true)
    expect(result.session).toBeUndefined()
    expect(result.message).toMatch(/confirm/i)
  })
})


/** A token GoTrue would return: only the payload is ever read, never verified. */
function jwtFor(claims: Record<string, string>): string {
  return `header.${btoa(JSON.stringify(claims))}.signature`
}

function configure() {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
}

describe('oauthUrl', () => {
  it('is null until a project is configured', () => {
    expect(oauthUrl('google')).toBeNull()
    expect(oauthUrl('apple')).toBeNull()
  })

  it('names the provider and sends the browser back to this page', () => {
    configure()

    const url = oauthUrl('apple')
    expect(url).toContain('/auth/v1/authorize?provider=apple')
    // The return address has to survive being a query parameter, or Supabase
    // rejects it against its allow-list.
    expect(url).toContain(`redirect_to=${encodeURIComponent(window.location.origin + '/')}`)
  })
})

describe('consumeOAuthRedirect', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('ignores a normal load with no fragment', () => {
    expect(consumeOAuthRedirect()).toEqual({ status: 'none' })
    expect(loadSession()).toBeNull()
  })

  it('ignores an ordinary route, so hash routing still works', () => {
    window.location.hash = '#/plugin/task-manager'
    expect(consumeOAuthRedirect()).toEqual({ status: 'none' })
    expect(window.location.hash).toBe('#/plugin/task-manager')
  })

  it('stores the session and scrubs the token out of the URL', () => {
    const token = jwtFor({ sub: 'user-9', email: 'oauth@example.com' })
    window.location.hash = `#access_token=${token}&refresh_token=r-9&expires_in=3600&token_type=bearer`

    const outcome = consumeOAuthRedirect()

    expect(outcome.status).toBe('signed-in')
    expect(loadSession()?.userId).toBe('user-9')
    expect(loadSession()?.email).toBe('oauth@example.com')

    // The whole point: a live access token must not stay in the address bar or
    // in history, and must not reach the hash router.
    expect(window.location.hash).toBe('')
  })

  it('reports a cancelled sign-in without storing anything', () => {
    window.location.hash = '#error=access_denied&error_description=The+user+denied+the+request'

    const outcome = consumeOAuthRedirect()

    expect(outcome).toEqual({ status: 'failed', message: 'Sign-in was cancelled.' })
    expect(loadSession()).toBeNull()
    expect(window.location.hash).toBe('')
  })

  it('refuses a fragment whose token carries no subject', () => {
    window.location.hash = `#access_token=${jwtFor({ email: 'x@example.com' })}&refresh_token=r`

    const outcome = consumeOAuthRedirect()

    expect(outcome.status).toBe('failed')
    expect(loadSession()).toBeNull()
  })
})

describe('refresh', () => {
  it('keeps the session when the server cannot be reached', async () => {
    configure()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    saveSession(SESSION)

    // Offline is not a verdict. Signing out here would lock someone out of a
    // database that lives on their own device.
    await expect(refresh(SESSION)).resolves.toEqual(SESSION)
    expect(loadSession()).toEqual(SESSION)
  })

  it('keeps the session when the server itself is broken', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    saveSession(SESSION)

    await expect(refresh(SESSION)).resolves.toEqual(SESSION)
    expect(loadSession()).toEqual(SESSION)
  })

  it('signs out only when the server rejects the token', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })))
    saveSession(SESSION)

    await expect(refresh(SESSION)).resolves.toBeNull()
    expect(loadSession()).toBeNull()
  })
})
