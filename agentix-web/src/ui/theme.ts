/**
 * Theme options, as data.
 *
 * Each accent carries a separate value per scheme rather than one hex for both.
 * A single mid-tone that looks right on near-black is usually too pale on
 * near-white, and vice versa — carrying both is what keeps a filled button
 * legible in either scheme instead of almost-legible in one of them.
 *
 * The Swift build reads the same ids and the same hex pairs.
 */

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeModeOption {
  id: ThemeMode
  label: string
  hint: string
}

export const THEME_MODES: ThemeModeOption[] = [
  { id: 'system', label: 'System', hint: 'Follows your device' },
  { id: 'light', label: 'Light', hint: 'Always light' },
  { id: 'dark', label: 'Dark', hint: 'Always dark' },
]

export interface AccentOption {
  id: string
  label: string
  /** Used when the resolved scheme is dark. */
  dark: string
  /** Used when the resolved scheme is light — darker, so white text still reads. */
  light: string
}

export const ACCENTS: AccentOption[] = [
  { id: 'blue', label: 'Blue', dark: '#6ea8fe', light: '#2563eb' },
  { id: 'violet', label: 'Violet', dark: '#b18cf7', light: '#7c3aed' },
  { id: 'emerald', label: 'Emerald', dark: '#4ade80', light: '#059669' },
  { id: 'cyan', label: 'Cyan', dark: '#4dd0e1', light: '#0e7490' },
  { id: 'amber', label: 'Amber', dark: '#fbbf24', light: '#b45309' },
  { id: 'orange', label: 'Orange', dark: '#fb923c', light: '#c2410c' },
  { id: 'rose', label: 'Rose', dark: '#fb7185', light: '#be123c' },
  { id: 'slate', label: 'Graphite', dark: '#a3b3c7', light: '#475569' },
]

export const DEFAULT_THEME_MODE: ThemeMode = 'system'
export const DEFAULT_ACCENT_ID = 'blue'

/** Unknown ids fall back rather than throw — a stale saved setting must still render. */
export function resolveAccent(id: string): AccentOption {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]!
}

export function accentColor(id: string, theme: ResolvedTheme): string {
  const accent = resolveAccent(id)
  return theme === 'dark' ? accent.dark : accent.light
}

/**
 * Turns a mode into the scheme actually rendered. `system` needs the device
 * preference, which the caller supplies so this stays a pure function.
 */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}
