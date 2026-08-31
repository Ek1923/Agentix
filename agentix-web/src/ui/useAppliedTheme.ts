import { useEffect, useSyncExternalStore } from 'react'
import { useSettings } from '../core/settings/store'
import { accentColor, resolveTheme, type ResolvedTheme } from './theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function subscribeToScheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia(DARK_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia(DARK_QUERY).matches
}

/**
 * Applies the chosen theme to the document and returns what is actually rendered.
 *
 * useSyncExternalStore rather than an effect, so a device switching to dark mode
 * while the app is open re-renders immediately and without a stale first frame.
 */
export function useAppliedTheme(): ResolvedTheme {
  const themeMode = useSettings((s) => s.themeMode)
  const accentId = useSettings((s) => s.accentId)

  const deviceDark = useSyncExternalStore(subscribeToScheme, prefersDark, () => true)
  const resolved = resolveTheme(themeMode, deviceDark)

  useEffect(() => {
    const root = document.documentElement
    // Stamped even for `system`, so the CSS never has to guess what won.
    root.dataset.theme = resolved
    root.style.setProperty('--color-accent', accentColor(accentId, resolved))
  }, [resolved, accentId])

  return resolved
}
