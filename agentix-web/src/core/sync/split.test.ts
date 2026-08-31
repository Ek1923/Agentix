// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTransports } from './split'

const access = {
  identity: { config: { url: 'https://id.example.com' } },
  data: { config: { url: 'https://project.supabase.co', anonKey: 'anon-key' } },
  session: { accessToken: 'keycloak-token', userId: 'u-1' },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The URL a pull would go to, which is how you tell the two transports apart. */
async function pullUrl(transportFor: NonNullable<ReturnType<typeof resolveTransports>['transportFor']>, table: Parameters<typeof transportFor>[0]) {
  const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  await transportFor(table).pull(table, '2026-08-30T00:00:00.000Z')
  return fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
}

describe('choosing what to sync against', () => {
  it('sends the roster to the organisation and the work to the person', async () => {
    const { scope, transportFor } = resolveTransports(access)
    expect(scope).toBe('both')

    const [rosterUrl] = await pullUrl(transportFor!, 'people')
    const [taskUrl] = await pullUrl(transportFor!, 'tasks')

    expect(rosterUrl).toContain('https://id.example.com/rest/v1/people')
    expect(taskUrl).toContain('https://project.supabase.co/rest/v1/tasks')
  })

  it('presents the same token to both, which is the whole point of route A', async () => {
    const { transportFor } = resolveTransports(access)

    const [, org] = await pullUrl(transportFor!, 'memberships')
    const [, own] = await pullUrl(transportFor!, 'notes')

    expect(org.headers.authorization).toBe('Bearer keycloak-token')
    expect(own.headers.authorization).toBe('Bearer keycloak-token')
    // The project key names the project, not the person — so only one side wants it.
    expect(own.headers.apikey).toBe('anon-key')
    expect(org.headers.apikey).toBeUndefined()
  })

  it('is the personal app when there is no organisation server', async () => {
    const { scope, transportFor } = resolveTransports({ ...access, identity: null })
    expect(scope).toBe('data-only')

    const [rosterUrl] = await pullUrl(transportFor!, 'people')
    expect(rosterUrl).toContain('https://project.supabase.co')
  })

  it('refuses to sync a roster while the work has nowhere to go', () => {
    // A pass that reports success while every task stays queued behind a backend
    // that is not there is worse than saying there is nothing to sync against.
    expect(resolveTransports({ ...access, data: null })).toEqual({
      scope: 'none',
      transportFor: null,
    })
  })

  it('syncs nothing while nobody is signed in', () => {
    expect(resolveTransports({ ...access, session: null }).scope).toBe('none')
  })
})
