// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettings } from '../core/settings/store'
import { ACCENTS, THEME_MODES, accentColor, resolveAccent, resolveTheme } from '../ui/theme'
import { Theme } from './Theme'

/** jsdom always reports light unless told otherwise; this flips the device. */
function setDevicePrefersDark(dark: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('dark') ? dark : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia
}

beforeEach(() => {
  localStorage.clear()
  useSettings.setState({ themeMode: 'system', accentId: 'blue' })
  setDevicePrefersDark(false)
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.removeProperty('--color-accent')
})

afterEach(cleanup)

describe('resolveTheme', () => {
  it('follows the device only in system mode', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')

    // An explicit choice ignores the device in both directions.
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('accents', () => {
  it('carries a distinct value per scheme', () => {
    for (const accent of ACCENTS) {
      expect(accent.dark).toMatch(/^#[0-9a-f]{6}$/i)
      expect(accent.light).toMatch(/^#[0-9a-f]{6}$/i)
      expect(accent.dark).not.toBe(accent.light)
    }
  })

  it('has unique ids and falls back on an unknown one', () => {
    expect(new Set(ACCENTS.map((a) => a.id)).size).toBe(ACCENTS.length)
    expect(resolveAccent('removed-in-a-later-version').id).toBe('blue')
  })

  it('picks the variant matching the scheme', () => {
    expect(accentColor('violet', 'dark')).toBe('#b18cf7')
    expect(accentColor('violet', 'light')).toBe('#7c3aed')
  })

  it('resolves the store defaults to real entries', () => {
    const { accentId, themeMode } = useSettings.getInitialState()
    expect(ACCENTS.some((a) => a.id === accentId)).toBe(true)
    expect(THEME_MODES.some((m) => m.id === themeMode)).toBe(true)
  })
})

describe('Theme screen', () => {
  it('offers every mode and accent', () => {
    render(<Theme onBack={() => {}} />)

    for (const mode of THEME_MODES) {
      expect(screen.getByRole('radio', { name: mode.label })).toBeInTheDocument()
    }
    for (const accent of ACCENTS) {
      expect(screen.getByRole('radio', { name: accent.label })).toBeInTheDocument()
    }
  })

  it('stamps the resolved scheme onto the document', async () => {
    const user = userEvent.setup()
    render(<Theme onBack={() => {}} />)

    // System, on a light device.
    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(useSettings.getState().themeMode).toBe('dark')

    await user.click(screen.getByRole('radio', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('an explicit choice beats the device preference', () => {
    setDevicePrefersDark(true)
    useSettings.setState({ themeMode: 'light' })

    render(<Theme onBack={() => {}} />)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('applies the accent as a CSS variable, in the right scheme variant', async () => {
    const user = userEvent.setup()
    useSettings.setState({ themeMode: 'dark' })
    render(<Theme onBack={() => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Emerald' }))

    expect(useSettings.getState().accentId).toBe('emerald')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(
      accentColor('emerald', 'dark'),
    )
  })

  it('swaps the accent variant when the scheme changes, without changing the choice', async () => {
    const user = userEvent.setup()
    useSettings.setState({ themeMode: 'dark', accentId: 'rose' })
    render(<Theme onBack={() => {}} />)

    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(
      accentColor('rose', 'dark'),
    )

    await user.click(screen.getByRole('radio', { name: 'Light' }))

    expect(useSettings.getState().accentId).toBe('rose')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(
      accentColor('rose', 'light'),
    )
  })

  it('survives a reload', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Theme onBack={() => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    await user.click(screen.getByRole('radio', { name: 'Amber' }))

    unmount()
    await useSettings.persist.rehydrate()
    render(<Theme onBack={() => {}} />)

    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Amber' })).toHaveAttribute('aria-checked', 'true')
  })

  it('goes back', async () => {
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(<Theme onBack={onBack} />)

    await user.click(screen.getByRole('button', { name: /Back/ }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
