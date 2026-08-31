import { describe, expect, it, vi } from 'vitest'
import {
  HEALTHY_INTERVAL_MS,
  HEALTH_PATH,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  checkHealth,
  describeHealth,
  isFailure,
  nextDelayMs,
} from './health'
import type { SupabaseConfig } from './supabase'

const CONFIG: SupabaseConfig = { url: 'https://abc.supabase.co', anonKey: 'K'.repeat(40) }

function respond(init: { status?: number; ok?: boolean }): typeof fetch {
  const status = init.status ?? 200
  return vi.fn(async () =>
    new Response(JSON.stringify({ name: 'GoTrue', version: '2.0.0' }), { status }),
  ) as unknown as typeof fetch
}

describe('nextDelayMs', () => {
  it('polls on the base interval while everything is fine', () => {
    expect(nextDelayMs(0)).toBe(HEALTHY_INTERVAL_MS)
  })

  it('backs off as failures pile up', () => {
    expect(nextDelayMs(1)).toBeGreaterThan(nextDelayMs(0))
    expect(nextDelayMs(3)).toBeGreaterThan(nextDelayMs(1))
  })

  it('never sleeps longer than the ceiling', () => {
    // However bad it gets, keep one slow heartbeat rather than giving up.
    expect(nextDelayMs(50)).toBe(MAX_INTERVAL_MS)
  })

  it('never polls faster than the floor', () => {
    for (let i = 0; i < 20; i++) expect(nextDelayMs(i)).toBeGreaterThanOrEqual(MIN_INTERVAL_MS)
  })

  it('recovers immediately, rather than easing back in', () => {
    // One success resets the streak, so a project that comes back is seen on the
    // next tick instead of ten minutes later.
    expect(nextDelayMs(0)).toBe(HEALTHY_INTERVAL_MS)
  })
})

describe('isFailure', () => {
  it('counts only an unanswered check against the streak', () => {
    expect(isFailure('offline')).toBe(true)
    // A refused key means the project is up. Backing off would be watching the
    // wrong problem.
    expect(isFailure('unauthorized')).toBe(false)
    expect(isFailure('online')).toBe(false)
    expect(isFailure('unknown')).toBe(false)
  })
})

describe('checkHealth', () => {
  it('asks the liveness endpoint, not a table', async () => {
    const fetchImpl = respond({})
    await checkHealth(CONFIG, fetchImpl)

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe(`https://abc.supabase.co${HEALTH_PATH}`)
    expect((init as RequestInit).method).toBe('GET')
  })

  it('sends the key as a header and never in the URL', async () => {
    const fetchImpl = respond({})
    await checkHealth(CONFIG, fetchImpl)

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(url)).not.toContain(CONFIG.anonKey)
    expect((init as RequestInit).headers).toMatchObject({ apikey: CONFIG.anonKey })
  })

  it('does not let a cached answer report a dead project as healthy', async () => {
    const fetchImpl = respond({})
    await checkHealth(CONFIG, fetchImpl)

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect((init as RequestInit).cache).toBe('no-store')
  })

  it('reports online with a latency', async () => {
    const result = await checkHealth(CONFIG, respond({}))
    expect(result.status).toBe('online')
    expect(result.latencyMs).not.toBeNull()
    expect(result.message).toMatch(/reachable/i)
  })

  it('tells a refused key apart from a dead project', async () => {
    const result = await checkHealth(CONFIG, respond({ status: 401 }))
    expect(result.status).toBe('unauthorized')
    expect(result.message).toMatch(/anon key/i)
  })

  it('treats a server error as offline', async () => {
    expect((await checkHealth(CONFIG, respond({ status: 503 }))).status).toBe('offline')
  })

  it('never throws, and never quotes the error it caught', async () => {
    const exploding = vi.fn(async () => {
      throw new Error(`connect failed to https://abc.supabase.co with apikey ${CONFIG.anonKey}`)
    }) as unknown as typeof fetch

    const result = await checkHealth(CONFIG, exploding)
    expect(result.status).toBe('offline')
    expect(result.latencyMs).toBeNull()
    // A caught error can carry the request, and the request carries the key.
    expect(result.message).not.toContain(CONFIG.anonKey)
  })

  it('gives up on a hung connection instead of stacking ticks', async () => {
    const hang = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    ) as unknown as typeof fetch

    const result = await checkHealth(CONFIG, hang, 10)
    expect(result.status).toBe('offline')
  })
})

describe('describeHealth', () => {
  it('calls out a slow project rather than only a reachable one', () => {
    const slow = describeHealth({ status: 'online', latencyMs: 3000, at: '', message: '' })
    expect(slow).toMatch(/slow/i)

    const quick = describeHealth({ status: 'online', latencyMs: 40, at: '', message: '' })
    expect(quick).not.toMatch(/slow/i)
    expect(quick).toMatch(/40 ms/)
  })

  it('has a sentence for every status', () => {
    for (const status of ['online', 'offline', 'unauthorized', 'unknown'] as const) {
      expect(describeHealth({ status, latencyMs: null, at: '', message: '' }).length).toBeGreaterThan(0)
    }
  })
})
