import type { Tier } from '../core/rank'

/**
 * The look of each rank. The engine (`core/rank.ts`) stays pure and names the
 * tier; the colour it wears lives here, on the UI side, keyed by that name.
 *
 * Each tier climbs in warmth and richness so the progression reads at a glance —
 * cool and quiet at the bottom, gold in the middle, and a two-colour sheen at
 * Professor that nothing below it has. The values are fixed hexes, not theme tokens:
 * a rank is the same rank in light and dark, and the badge paints its own ground.
 */
export interface TierStyle {
  /** The solid accent — ring, flame, emphasis. */
  accent: string
  /** Gradient stops for a filled badge or bar. */
  from: string
  to: string
  /** Readable text on top of the gradient. */
  on: string
}

const STYLES: Record<Tier['key'], TierStyle> = {
  intern: { accent: '#64748b', from: '#94a3b8', to: '#64748b', on: '#ffffff' },
  junior: { accent: '#10b981', from: '#34d399', to: '#059669', on: '#ffffff' },
  senior: { accent: '#0ea5e9', from: '#38bdf8', to: '#0284c7', on: '#ffffff' },
  lead: { accent: '#8b5cf6', from: '#a78bfa', to: '#7c3aed', on: '#ffffff' },
  director: { accent: '#f59e0b', from: '#fbbf24', to: '#d97706', on: '#3b2600' },
  executive: { accent: '#f43f5e', from: '#fb7185', to: '#e11d48', on: '#ffffff' },
  professor: { accent: '#14b8a6', from: '#2dd4bf', to: '#c026d3', on: '#ffffff' },
}

export function tierStyle(key: Tier['key']): TierStyle {
  return STYLES[key]
}

/** `linear-gradient(...)` for a tier, at a given angle. */
export function tierGradient(key: Tier['key'], angle = 135): string {
  const s = STYLES[key]
  return `linear-gradient(${angle}deg, ${s.from}, ${s.to})`
}

/**
 * A soft wash of the tier colour that fades to transparent, for tinting a header
 * behind content.
 *
 * A flat translucent fill read as a distinctly lighter panel with a hard seam
 * where it stopped. This instead glows from one corner and melts to nothing, so it
 * blends into whatever it sits over rather than drawing a brighter rectangle.
 * The `26`/`00` suffixes are 8-digit-hex alpha: ~15% at the source, fully clear by
 * two-thirds down.
 */
export function tierWash(key: Tier['key'], angle = 155): string {
  const s = STYLES[key]
  return `linear-gradient(${angle}deg, ${s.from}26, ${s.from}00 66%)`
}
