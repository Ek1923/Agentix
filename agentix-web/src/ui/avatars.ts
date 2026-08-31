import {
  Anchor,
  Compass,
  Feather,
  Flame,
  Leaf,
  Moon,
  Mountain,
  Rocket,
  Sparkles,
  Sun,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/**
 * Avatars and their backgrounds, as data.
 *
 * No image files and no network: an avatar is a glyph plus a two-stop gradient,
 * which means it works offline, stays sharp at any size, costs nothing to ship,
 * and survives the privacy rule that `src/` contacts no external host.
 *
 * Both lists are plain values on purpose — the Swift build reads the same ids,
 * the same hex stops, and the same angle, so a profile looks identical there.
 */

export interface AvatarOption {
  id: string
  label: string
  /** Null means "draw the person's initials instead of a glyph". */
  icon: LucideIcon | null
}

export const AVATARS: AvatarOption[] = [
  { id: 'initials', label: 'Initials', icon: null },
  { id: 'sparkles', label: 'Sparkles', icon: Sparkles },
  { id: 'rocket', label: 'Rocket', icon: Rocket },
  { id: 'mountain', label: 'Mountain', icon: Mountain },
  { id: 'waves', label: 'Waves', icon: Waves },
  { id: 'zap', label: 'Bolt', icon: Zap },
  { id: 'leaf', label: 'Leaf', icon: Leaf },
  { id: 'moon', label: 'Moon', icon: Moon },
  { id: 'sun', label: 'Sun', icon: Sun },
  { id: 'compass', label: 'Compass', icon: Compass },
  { id: 'feather', label: 'Feather', icon: Feather },
  { id: 'flame', label: 'Flame', icon: Flame },
  { id: 'anchor', label: 'Anchor', icon: Anchor },
]

export interface BackgroundOption {
  id: string
  label: string
  from: string
  to: string
  angle: number
  /**
   * Which glyph colour stays legible on this gradient. Carried as data rather than
   * guessed at render time, so a pale background never gets white glyphs on it.
   */
  ink: 'light' | 'dark'
}

export const BACKGROUNDS: BackgroundOption[] = [
  { id: 'slate', label: 'Slate', from: '#475569', to: '#0f172a', angle: 145, ink: 'light' },
  { id: 'ocean', label: 'Ocean', from: '#38bdf8', to: '#1e40af', angle: 145, ink: 'light' },
  { id: 'violet', label: 'Violet', from: '#c084fc', to: '#6d28d9', angle: 145, ink: 'light' },
  { id: 'forest', label: 'Forest', from: '#4ade80', to: '#15803d', angle: 145, ink: 'light' },
  { id: 'ember', label: 'Ember', from: '#fb923c', to: '#b91c1c', angle: 145, ink: 'light' },
  { id: 'rose', label: 'Rose', from: '#fb7185', to: '#9f1239', angle: 145, ink: 'light' },
  { id: 'gold', label: 'Gold', from: '#fcd34d', to: '#b45309', angle: 145, ink: 'dark' },
  { id: 'mist', label: 'Mist', from: '#8ab4d8', to: '#1e3a5f', angle: 145, ink: 'light' },
]

export const DEFAULT_AVATAR_ID = 'initials'
export const DEFAULT_BACKGROUND_ID = 'slate'

/** Unknown ids fall back rather than throw — a stale saved setting must still render. */
export function resolveAvatar(id: string): AvatarOption {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0]!
}

export function resolveBackground(id: string): BackgroundOption {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0]!
}

export function backgroundCss(bg: BackgroundOption): string {
  return `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`
}

/** Up to two letters from the name. Falls back to a dot rather than empty space. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}
