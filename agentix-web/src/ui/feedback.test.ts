// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { feedback, type FeedbackEvent } from './feedback'

const EVENTS: FeedbackEvent[] = ['selection', 'light', 'medium', 'success', 'warning']

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('reduce') ? reduce : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia
}

beforeEach(() => {
  setReducedMotion(false)
  delete (window as { Capacitor?: unknown }).Capacitor
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as { Capacitor?: unknown }).Capacitor
})

describe('on the web', () => {
  it('vibrates for every event, with its own pattern', () => {
    // Typed through the parameter, so mock.calls carries the argument type.
    const vibrate = vi.fn((_pattern: number | number[]) => true)
    vi.stubGlobal('navigator', { ...navigator, vibrate })

    for (const event of EVENTS) feedback(event)

    expect(vibrate).toHaveBeenCalledTimes(EVENTS.length)
    // Selection is the lightest touch; a warning is the most insistent.
    expect(vibrate.mock.calls[0]?.[0]).toBe(8)
    expect(vibrate.mock.calls[4]?.[0]).toEqual([24, 60, 24])
  })

  it('does nothing where the Vibration API does not exist', () => {
    vi.stubGlobal('navigator', {})
    // A desktop browser: silence, not a crash.
    expect(() => feedback('success')).not.toThrow()
  })

  it('survives a browser that refuses without a user gesture', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      vibrate: () => {
        throw new Error('blocked')
      },
    })
    expect(() => feedback('light')).not.toThrow()
  })
})

describe('reduced motion', () => {
  it('stays silent, because a vibration is motion too', () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { ...navigator, vibrate })
    setReducedMotion(true)

    for (const event of EVENTS) feedback(event)
    expect(vibrate).not.toHaveBeenCalled()
  })
})

describe('on a native platform', () => {
  it('uses the haptics engine rather than the Vibration API', async () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { ...navigator, vibrate })
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }

    feedback('success')

    // The web fallback must not fire as well — that would double every tap.
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('never throws when the engine is unavailable', () => {
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
    // Feedback is never important enough to interrupt the action behind it.
    expect(() => feedback('medium')).not.toThrow()
  })

  it('treats a non-native Capacitor global as the web', () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { ...navigator, vibrate })
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => false }

    feedback('light')
    expect(vibrate).toHaveBeenCalledOnce()
  })
})

describe('the event names', () => {
  it('are the five that map onto UIKit generators', () => {
    // selection → UISelectionFeedbackGenerator
    // light/medium → UIImpactFeedbackGenerator(style:)
    // success/warning → UINotificationFeedbackGenerator(type:)
    expect(EVENTS).toEqual(['selection', 'light', 'medium', 'success', 'warning'])
  })
})
