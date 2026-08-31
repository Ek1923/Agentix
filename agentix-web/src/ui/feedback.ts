/**
 * Interaction feedback, named by meaning rather than by sensation.
 *
 * The names were chosen before any native platform existed, so that adding one
 * would be a change to this file and nothing else. That is now cashed in: the
 * event names map straight onto UIKit's generators, and every call site in the
 * app was already correct.
 *
 *   selection        → UISelectionFeedbackGenerator
 *   light / medium   → UIImpactFeedbackGenerator(style:)
 *   success / warning → UINotificationFeedbackGenerator(type:)
 */

export type FeedbackEvent =
  | 'selection' // moved between options: a bucket, a day, a swatch
  | 'light' // a small confirmed action: added, moved
  | 'medium' // a deliberate state change: timer started or stopped
  | 'success' // finished something: task completed, key verified
  | 'warning' // refused or reverted: invalid input, failed test

/** Milliseconds, for the web fallback. Short and unobtrusive — feedback, not an alarm. */
const PATTERNS: Record<FeedbackEvent, number | number[]> = {
  selection: 8,
  light: 12,
  medium: 20,
  success: [14, 40, 14],
  warning: [24, 60, 24],
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
}

/**
 * Whether a real haptics engine is available.
 *
 * Read off the global rather than by importing Capacitor, so a plain web build
 * never loads a native bridge just to answer "no".
 */
function isNative(): boolean {
  if (typeof window === 'undefined') return false
  const capacitor = (window as { Capacitor?: CapacitorGlobal }).Capacitor
  return capacitor?.isNativePlatform?.() === true
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Imported once and reused: a tap must not wait on a module load. */
let hapticsModule: Promise<typeof import('@capacitor/haptics')> | null = null

function loadHaptics(): Promise<typeof import('@capacitor/haptics')> {
  hapticsModule ??= import('@capacitor/haptics')
  return hapticsModule
}

async function nativeFeedback(event: FeedbackEvent): Promise<void> {
  const { Haptics, ImpactStyle, NotificationType } = await loadHaptics()

  if (event === 'selection') return Haptics.selectionChanged()
  if (event === 'light') return Haptics.impact({ style: ImpactStyle.Light })
  if (event === 'medium') return Haptics.impact({ style: ImpactStyle.Medium })
  if (event === 'success') return Haptics.notification({ type: NotificationType.Success })
  return Haptics.notification({ type: NotificationType.Warning })
}

/**
 * Fires the feedback for an interaction moment.
 *
 * Safe to call from anywhere, on any platform. Native devices get a real haptic;
 * a phone browser gets the Vibration API; a desktop browser and an unsupported
 * WebView get nothing. Someone who asked for reduced motion gets silence —
 * a vibration is motion they did not consent to either.
 *
 * Never awaited by a caller and never allowed to throw: feedback is not important
 * enough to interrupt the action that triggered it.
 */
export function feedback(event: FeedbackEvent): void {
  if (prefersReducedMotion()) return

  if (isNative()) {
    void nativeFeedback(event).catch(() => {
      // A device with the engine disabled, or a plugin that failed to load.
    })
    return
  }

  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(PATTERNS[event])
  } catch {
    // A browser may refuse without a user gesture.
  }
}
