// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Syncable } from '../db/types'
import {
  createIdentityTransport,
  isIdentityConfigured,
  readIdentityConfig,
  realmUrl,
  saveIdentityUrl,
} from './identity'

const SERVER = { url: 'https://id.example.com' }

function row(overrides: Partial<Syncable> = {}): Syncable {
  return {
    id: 'org-1',
    createdAt: '2026-08-31T09:00:00.000Z',
    updatedAt: '2026-08-31T09:00:00.000Z',
    deletedAt: null,
    ...overrides,
  } as Syncable
}

function transport() {
  return createIdentityTransport({ config: SERVER, accessToken: 'keycloak-token', userId: 'u-1' })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('where the organisation server is', () => {
  it('remembers what this device was pointed at, without the trailing slash', () => {
    saveIdentityUrl('https://id.example.com/')

    expect(readIdentityConfig()).toEqual({ url: 'https://id.example.com' })
    expect(isIdentityConfigured()).toBe(true)
  })

  it('refuses plain http, because a token and a roster travel over this', () => {
    saveIdentityUrl('http://id.example.com')

    expect(readIdentityConfig()).toBeNull()
  })

  it('allows localhost, which is where the box is tested from', () => {
    saveIdentityUrl('http://localhost:8080')

    expect(readIdentityConfig()?.url).toBe('http://localhost:8080')
  })

  it('ignores something that is not a URL at all', () => {
    saveIdentityUrl('id.example.com')

    expect(readIdentityConfig()).toBeNull()
  })

  it('forgets on request', () => {
    saveIdentityUrl('https://id.example.com')
    saveIdentityUrl(null)

    expect(readIdentityConfig()).toBeNull()
  })

  it('knows where the realm lives', () => {
    expect(realmUrl(SERVER)).toBe('https://id.example.com/realms/agentix')
  })
})

describe('talking to it', () => {
  it('asks for rows changed since the cursor, with the token and no project key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await transport().pull('people', '2026-08-30T00:00:00.000Z')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('https://id.example.com/rest/v1/people?select=*')
    expect(url).toContain('updated_at=gte.2026-08-30T00%3A00%3A00.000Z')
    expect(init.headers.authorization).toBe('Bearer keycloak-token')
    // Supabase wants an apikey naming the project; a server that hosts one thing
    // has nothing to name.
    expect(init.headers.apikey).toBeUndefined()
  })

  it('reads snake_case back as the app writes it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            { id: 'm-1', org_id: 'o-1', allowed_plugin_ids: ['agenda'], user_id: 'someone' },
          ]),
          { status: 200 },
        ),
      ),
    )

    const rows = await transport().pull('memberships', '2026-08-30T00:00:00.000Z')

    expect(rows[0]).toEqual({ id: 'm-1', orgId: 'o-1', allowedPluginIds: ['agenda'] })
  })

  it('upserts on push, so a retry is not a duplicate-key failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await transport().push('people', [row({ id: 'p-1' })])

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://id.example.com/rest/v1/people')
    expect(init.headers.prefer).toContain('resolution=merge-duplicates')
    // Who last wrote the row. On this server it is a record, not the policy.
    expect(JSON.parse(init.body)[0].user_id).toBe('u-1')
  })

  it('sends nothing at all when there is nothing to send', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await transport().push('people', [])

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses to carry a table that belongs to the other backend', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(transport().pull('tasks', '2026-08-30T00:00:00.000Z')).rejects.toThrow(
      /does not belong to the organisation server/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says the sign-in expired on a refusal, rather than something cryptic', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))

    await expect(transport().pull('people', '2026-08-30T00:00:00.000Z')).rejects.toThrow(
      /Sign-in expired/,
    )
  })

  it('never lets a network error carry the request, which carries the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('failed to fetch https://id.example.com?token=secret')),
    )

    await expect(transport().pull('people', '2026-08-30T00:00:00.000Z')).rejects.toThrow(
      'Could not reach the server. Your work is saved here.',
    )
  })
})
