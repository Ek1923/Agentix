import { describe, expect, it, vi } from 'vitest'
import type { SupabaseConfig } from '../sync/supabase'
import {
  ASSUME_ALL,
  SETTINGS_PATH,
  describeMissingProviders,
  fetchEnabledProviders,
  parseEnabledProviders,
} from './providers'

const CONFIG: SupabaseConfig = { url: 'https://abc.supabase.co', anonKey: 'K'.repeat(40) }

function settings(external: Record<string, boolean>): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({ external }), { status: 200 })) as unknown as typeof fetch
}

describe('parseEnabledProviders', () => {
  it('offers only what the project has switched on', () => {
    const enabled = parseEnabledProviders({
      external: { email: true, google: false, apple: false, github: true, azure: true },
    })

    // azure is on and still not offered: the app has no button for it.
    expect(enabled.oauth).toEqual(['github'])
    expect(enabled.email).toBe(true)
    expect(enabled.known).toBe(true)
  })

  it('keeps the app’s own order rather than the payload’s', () => {
    const enabled = parseEnabledProviders({
      external: { github: true, apple: true, google: true },
    })

    expect(enabled.oauth).toEqual(['google', 'apple', 'github'])
  })

  it('treats a payload it cannot read as an unanswered question', () => {
    // Not as "nothing is enabled" — hiding every button on a shape change would
    // lock somebody out of a project that is working fine.
    for (const payload of [null, 'nope', {}, { external: null }, { external: 7 }]) {
      expect(parseEnabledProviders(payload)).toEqual(ASSUME_ALL)
    }
  })

  it('reads a missing email flag as present, and an explicit false as off', () => {
    expect(parseEnabledProviders({ external: { google: true } }).email).toBe(true)
    expect(parseEnabledProviders({ external: { email: false } }).email).toBe(false)
  })
})

describe('fetchEnabledProviders', () => {
  it('asks the project’s own settings endpoint, with the key in a header', async () => {
    const impl = settings({ email: true, google: true, apple: false, github: false })
    const enabled = await fetchEnabledProviders(CONFIG, impl)

    const [url, init] = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(url).toBe(`${CONFIG.url}${SETTINGS_PATH}`)
    expect((init.headers as Record<string, string>).apikey).toBe(CONFIG.anonKey)
    // Never in the URL, where it would end up in a log or a history entry.
    expect(url).not.toContain(CONFIG.anonKey)
    expect(enabled.oauth).toEqual(['google'])
  })

  it('fails open when the project refuses', async () => {
    const impl = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch
    expect(await fetchEnabledProviders(CONFIG, impl)).toEqual(ASSUME_ALL)
  })

  it('fails open when there is no answer at all', async () => {
    const impl = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch

    // A probe that fails must never be the reason somebody cannot sign in.
    expect(await fetchEnabledProviders(CONFIG, impl)).toEqual(ASSUME_ALL)
  })

  it('fails open on a body that is not JSON', async () => {
    const impl = vi.fn(async () => new Response('<html>nope', { status: 200 })) as unknown as typeof fetch
    expect(await fetchEnabledProviders(CONFIG, impl)).toEqual(ASSUME_ALL)
  })
})

describe('describeMissingProviders', () => {
  it('names one missing provider in the singular', () => {
    const line = describeMissingProviders({ oauth: ['google', 'apple'], email: true, known: true })
    expect(line).toContain('GitHub is switched off')
  })

  it('lists several, and says where to switch them on', () => {
    const line = describeMissingProviders({ oauth: ['github'], email: true, known: true })
    expect(line).toContain('Google and Apple are switched off')
    expect(line).toContain('Authentication')
  })

  it('says nothing when everything is on', () => {
    expect(
      describeMissingProviders({ oauth: ['google', 'apple', 'github'], email: true, known: true }),
    ).toBeNull()
  })

  it('claims nothing about a project that never answered', () => {
    expect(describeMissingProviders(ASSUME_ALL)).toBeNull()
  })
})
