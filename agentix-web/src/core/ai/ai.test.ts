import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAIService, providers, testConnection } from './index'
import { deleteKey, getKey, listConfiguredProviders, setKey } from './secure-store'

// Key-shaped but self-identifying, so the secret scan can tell a fixture from a
// leak instead of crying wolf on every test file. See `npm run scan-secrets`.
const ANTHROPIC_KEY = 'sk-ant-api03-FAKEKEYFORTESTS0001'
const OPENAI_KEY = 'sk-proj-FAKEKEYFORTESTS0002'

beforeEach(async () => {
  await deleteKey('anthropic')
  await deleteKey('openai')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('secure store', () => {
  it('round-trips a key', async () => {
    await setKey('anthropic', ANTHROPIC_KEY)
    expect(await getKey('anthropic')).toBe(ANTHROPIC_KEY)
  })

  it('keeps each provider separate', async () => {
    await setKey('anthropic', ANTHROPIC_KEY)
    await setKey('openai', OPENAI_KEY)

    expect(await getKey('anthropic')).toBe(ANTHROPIC_KEY)
    expect(await getKey('openai')).toBe(OPENAI_KEY)

    // Deleting one must not touch the other.
    await deleteKey('anthropic')
    expect(await getKey('anthropic')).toBeNull()
    expect(await getKey('openai')).toBe(OPENAI_KEY)
  })

  it('reports which providers are configured without returning keys', async () => {
    await setKey('openai', OPENAI_KEY)
    expect(await listConfiguredProviders()).toEqual(['openai'])
  })
})

describe('key patterns', () => {
  it('accepts real-shaped keys and rejects typos', () => {
    expect(providers.anthropic.keyPattern.test(ANTHROPIC_KEY)).toBe(true)
    expect(providers.openai.keyPattern.test(OPENAI_KEY)).toBe(true)

    expect(providers.anthropic.keyPattern.test('not-a-key')).toBe(false)
    expect(providers.anthropic.keyPattern.test('sk-ant-short')).toBe(false)
    // An OpenAI key pasted into the Anthropic field is the likeliest real mistake.
    expect(providers.anthropic.keyPattern.test(OPENAI_KEY)).toBe(false)
  })
})

describe('ai.complete', () => {
  it('refuses with a clear message when no key is set', async () => {
    const ai = createAIService(() => ({ providerId: 'anthropic', model: 'claude-opus-5' }))
    await expect(ai.complete('hi')).rejects.toThrow(/No API key set for Anthropic/)
  })

  it('reports configured state per active provider', async () => {
    await setKey('openai', OPENAI_KEY)

    const anthropicAI = createAIService(() => ({ providerId: 'anthropic', model: 'x' }))
    const openaiAI = createAIService(() => ({ providerId: 'openai', model: 'x' }))

    expect(await anthropicAI.isConfigured()).toBe(false)
    expect(await openaiAI.isConfigured()).toBe(true)
  })

  it('sends the key as a header, never in the URL or body', async () => {
    await setKey('anthropic', ANTHROPIC_KEY)

    let sent: { url: string; init: RequestInit } | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        sent = { url: String(url), init: init ?? {} }
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'hello' }] }), {
          status: 200,
        })
      }),
    )

    const ai = createAIService(() => ({ providerId: 'anthropic', model: 'claude-opus-5' }))
    expect(await ai.complete('say hello')).toBe('hello')

    const call = sent as { url: string; init: RequestInit } | null
    expect(call).not.toBeNull()
    expect(call!.url).not.toContain(ANTHROPIC_KEY)
    expect(String(call!.init.body)).not.toContain(ANTHROPIC_KEY)
    expect((call!.init.headers as Record<string, string>)['x-api-key']).toBe(ANTHROPIC_KEY)
  })
})

describe('testConnection', () => {
  it('catches a malformed key before spending a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await testConnection('anthropic', 'claude-opus-5', 'oops')
    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports success on a valid key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
            status: 200,
          }),
      ),
    )

    const result = await testConnection('anthropic', 'claude-opus-5', ANTHROPIC_KEY)
    expect(result).toEqual({ ok: true, message: 'Anthropic key works.' })
  })

  it('distinguishes a rejected key from a rate limit from an outage', async () => {
    const cases: Array<[number, RegExp]> = [
      [401, /Key rejected/],
      [429, /Rate limited/],
      [503, /having trouble/],
    ]

    for (const [status, expected] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })))
      const result = await testConnection('openai', 'gpt-4.1', OPENAI_KEY)
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(expected)
    }
  })

  it('never puts the key into a failure message', async () => {
    // A provider that echoes the request back in its error body — the realistic
    // way a key leaks into a UI string.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: ANTHROPIC_KEY }), { status: 400 })),
    )

    const result = await testConnection('anthropic', 'claude-opus-5', ANTHROPIC_KEY)
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain(ANTHROPIC_KEY)
    expect(result.message).not.toContain('sk-ant')
  })

  it('reports a network failure without exposing the caught error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`connect failed for x-api-key ${ANTHROPIC_KEY}`)
      }),
    )

    const result = await testConnection('anthropic', 'claude-opus-5', ANTHROPIC_KEY)
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain(ANTHROPIC_KEY)
    expect(result.message).toMatch(/Could not reach Anthropic/)
  })
})
