// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Syncable } from '../db/types'
import { createSupabaseTransport, isSyncConfigured, readSupabaseConfig } from './supabase'

const CONFIG = { url: 'https://example.supabase.co', anonKey: 'anon-key' }
const TOKEN = 'access-token-value'

function transport() {
  return createSupabaseTransport({ config: CONFIG, accessToken: TOKEN, userId: 'user-1' })
}

function captureFetch(response = new Response('[]', { status: 200 })) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return response.clone()
    }),
  )
  return calls
}

beforeEach(() => {
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('configuration', () => {
  it('is absent until both values are set', () => {
    expect(readSupabaseConfig()).toBeNull()
    expect(isSyncConfigured()).toBe(false)

    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    expect(readSupabaseConfig()).toBeNull()

    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    expect(isSyncConfigured()).toBe(true)
  })

  it('trims a trailing slash so paths do not double up', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co/')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    expect(readSupabaseConfig()?.url).toBe('https://example.supabase.co')
  })

  it('treats blank values as unconfigured', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '   ')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    expect(isSyncConfigured()).toBe(false)
  })
})

describe('pull', () => {
  it('asks only for rows at or after the cursor', async () => {
    const calls = captureFetch()
    await transport().pull('tasks', '2026-08-27T10:00:00.000Z')

    expect(calls[0]?.url).toContain('/rest/v1/tasks')
    expect(calls[0]?.url).toContain('updated_at=gte.')
    expect(calls[0]?.url).toContain(encodeURIComponent('2026-08-27T10:00:00.000Z'))
  })

  it('maps table names to their Postgres equivalents', async () => {
    const calls = captureFetch()
    await transport().pull('sessions', '2026-01-01T00:00:00.000Z')
    await transport().pull('habitLogs', '2026-01-01T00:00:00.000Z')

    expect(calls[0]?.url).toContain('/rest/v1/time_sessions')
    expect(calls[1]?.url).toContain('/rest/v1/habit_logs')
  })

  it('converts snake_case columns back to the shape the app uses', async () => {
    captureFetch(
      new Response(
        JSON.stringify([
          {
            id: 't1',
            user_id: 'user-1',
            planned_for: '2026-08-27',
            estimate_min: 45,
            updated_at: '2026-08-27T10:00:00.000Z',
            deleted_at: null,
          },
        ]),
        { status: 200 },
      ),
    )

    const [row] = await transport().pull('tasks', '2026-01-01T00:00:00.000Z')

    expect(row).toMatchObject({
      id: 't1',
      plannedFor: '2026-08-27',
      estimateMin: 45,
      updatedAt: '2026-08-27T10:00:00.000Z',
      deletedAt: null,
    })
    // The server's own column is not part of the app's model.
    expect(row).not.toHaveProperty('userId')
  })
})

describe('push', () => {
  it('upserts, so a retried push is harmless', async () => {
    const calls = captureFetch()
    await transport().push('tasks', [
      { id: 't1', updatedAt: '2026-08-27T10:00:00.000Z', deletedAt: null } as Syncable,
    ])

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(calls[0]?.init.method).toBe('POST')
    expect(headers['prefer']).toContain('merge-duplicates')
  })

  it('stamps the row with the signed-in user and snake-cases the keys', async () => {
    const calls = captureFetch()
    await transport().push('tasks', [
      {
        id: 't1',
        updatedAt: '2026-08-27T10:00:00.000Z',
        deletedAt: null,
        plannedFor: '2026-08-27',
      } as unknown as Syncable,
    ])

    const body = JSON.parse(String(calls[0]?.init.body)) as Array<Record<string, unknown>>
    expect(body[0]).toMatchObject({
      id: 't1',
      user_id: 'user-1',
      planned_for: '2026-08-27',
      updated_at: '2026-08-27T10:00:00.000Z',
    })
  })

  it('sends nothing at all for an empty batch', async () => {
    const calls = captureFetch()
    await transport().push('tasks', [])
    expect(calls).toHaveLength(0)
  })

  it('sends the token as a header, never in the URL or body', async () => {
    const calls = captureFetch()
    await transport().push('tasks', [
      { id: 't1', updatedAt: '2026-08-27T10:00:00.000Z', deletedAt: null } as Syncable,
    ])

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['authorization']).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]?.url).not.toContain(TOKEN)
    expect(String(calls[0]?.init.body)).not.toContain(TOKEN)
  })
})

describe('failures', () => {
  it('names an expired sign-in rather than a status code', async () => {
    captureFetch(new Response('{}', { status: 401 }))
    await expect(transport().pull('tasks', '2026-01-01T00:00:00.000Z')).rejects.toThrow(
      /Sign-in expired/,
    )
  })

  it('reassures that nothing is lost when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`connect failed carrying ${TOKEN}`)
      }),
    )

    await expect(transport().pull('tasks', '2026-01-01T00:00:00.000Z')).rejects.toThrow(
      /Your work is saved here/,
    )
  })

  it('never puts the access token into an error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`connect failed carrying ${TOKEN}`)
      }),
    )

    await expect(
      transport().pull('tasks', '2026-01-01T00:00:00.000Z'),
    ).rejects.toThrow(expect.not.stringContaining(TOKEN) as unknown as string)
  })
})
