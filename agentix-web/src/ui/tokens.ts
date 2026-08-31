/**
 * Design tokens. These are re-read by the Swift build, so they are plain values
 * with no Tailwind or CSS dependency — a number here becomes a number there.
 */

/** 4pt base scale. Matches the iOS default grid so layouts port without re-tuning. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  full: 9999,
} as const

/**
 * Motion. Chosen deliberately — these timings are reused on iOS.
 *
 * `fast` is the perceptual floor for a tap acknowledgement: fast enough to feel
 * instant, slow enough to be seen. `medium` covers screen transitions, where the
 * eye needs to track something moving to know where it went.
 */
export const duration = {
  fast: 0.15,     // seconds — taps, toggles, hover
  medium: 0.25,   // screen transitions
  slow: 0.4,      // rare — first paint, onboarding reveals
} as const

/** Ease-out: motion decelerates into place. Entrances land, they do not bounce. */
type Bezier = [number, number, number, number]

export const easing: { out: Bezier; inOut: Bezier } = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
}

/** Ready to spread into a Framer Motion `transition` prop. */
export const transition = {
  tap: { duration: duration.fast, ease: easing.out },
  screen: { duration: duration.medium, ease: easing.out },
} as const

export const tokens = { spacing, radius, duration, easing, transition } as const
