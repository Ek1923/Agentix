import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { LevelUp } from '../../core/rank'
import { feedback } from '../feedback'
import { tierGradient, tierStyle, tierWash } from '../rankStyle'
import { duration, easing, transition } from '../tokens'

/** How long the moment stays before it withdraws on its own. */
const LINGER_MS = 6500

/** Where the sparks fly. Fixed angles rather than random, so it reads composed. */
const SPARKS = [-64, -30, -6, 18, 44, 72, 108, 146]

/**
 * The moment a level is crossed.
 *
 * Deliberately a moment and not a screen: it arrives wherever you were, says the
 * one thing worth saying, and leaves. Finishing the task is the achievement — an
 * interruption that has to be dismissed before you can carry on would make the
 * reward cost more than it gives.
 *
 * Presentational. The store decides *that* a level was crossed and remembers it
 * across a reload; this only knows how to make it feel like something.
 */
export function LevelUpToast({
  celebration,
  onDismiss,
}: {
  celebration: LevelUp | null
  onDismiss: () => void
}) {
  const reduced = useReducedMotion() ?? false

  // Withdraws on its own, and on Escape — the same key that closes everything else.
  useEffect(() => {
    if (celebration === null) return

    // The named moment the iOS build maps to a notification generator.
    feedback('success')

    const timer = setTimeout(onDismiss, LINGER_MS)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [celebration, onDismiss])

  return (
    <AnimatePresence>
      {celebration !== null && (
        <motion.div
          // The layer is inert; only the card inside takes the pointer, so this
          // never swallows a tap meant for the screen behind it.
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          initial={{ opacity: 0, y: reduced ? 0 : 28, scale: reduced ? 1 : 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: reduced ? 0 : 12, scale: reduced ? 1 : 0.98 }}
          transition={
            reduced
              ? { duration: duration.fast }
              : { type: 'spring', stiffness: 420, damping: 30, mass: 0.9 }
          }
        >
          <div
            role="status"
            aria-live="polite"
            className="card card-lift pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: tierWash(celebration.tier.key, 120) }}
            />

            {/* A single light sweeping across, once. The polish that says "arrived". */}
            {!reduced && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-1/3"
                style={{
                  backgroundImage:
                    'linear-gradient(100deg, transparent, rgb(255 255 255 / 0.16), transparent)',
                }}
                initial={{ x: '-120%' }}
                animate={{ x: '420%' }}
                transition={{ duration: 1.1, ease: easing.out, delay: 0.15 }}
              />
            )}

            <div className="relative flex items-center gap-4 p-4">
              <Medallion celebration={celebration} reduced={reduced} />

              <div className="min-w-0 flex-1">
                <div className="eyebrow" style={{ color: tierStyle(celebration.tier.key).accent }}>
                  {celebration.promoted ? 'Promoted' : 'Level up'}
                </div>
                <div className="display text-lg text-ink">
                  {celebration.promoted
                    ? `You’re a ${celebration.tier.name}`
                    : `Level ${celebration.to}`}
                </div>
                <div className="text-xs text-muted">
                  {celebration.promoted
                    ? `Level ${celebration.to} · a new rank`
                    : celebration.to - celebration.from > 1
                      ? `${celebration.from} → ${celebration.to}, in one go`
                      : `${celebration.tier.name} · keep the streak`}
                </div>
              </div>

              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss"
                className="-m-1 shrink-0 self-start rounded-full p-1 text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            {/* The time it has left, draining. Tells you it will go without saying so. */}
            <motion.div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[3px] origin-left"
              style={{ backgroundImage: tierGradient(celebration.tier.key, 90) }}
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: LINGER_MS / 1000, ease: 'linear' }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The level itself, landing: a filled disc, a halo, and a burst that fades. */
function Medallion({ celebration, reduced }: { celebration: LevelUp; reduced: boolean }) {
  const style = tierStyle(celebration.tier.key)

  return (
    <span className="relative flex size-14 shrink-0 items-center justify-center">
      {!reduced && (
        <>
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{ backgroundImage: tierGradient(celebration.tier.key) }}
            initial={{ opacity: 0.55, scale: 1 }}
            animate={{ opacity: 0, scale: 2.1 }}
            transition={{ duration: 0.9, ease: easing.out }}
          />
          {SPARKS.map((angle) => (
            <motion.span
              aria-hidden
              key={angle}
              className="absolute size-1.5 rounded-full"
              style={{ backgroundColor: style.accent }}
              initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              animate={{
                opacity: 0,
                x: Math.cos((angle * Math.PI) / 180) * 46,
                y: Math.sin((angle * Math.PI) / 180) * 46,
                scale: 0.4,
              }}
              transition={{ duration: 0.75, ease: easing.out, delay: 0.05 }}
            />
          ))}
        </>
      )}

      <motion.span
        className="display relative flex size-14 items-center justify-center rounded-full text-xl tabular-nums"
        style={{
          backgroundImage: tierGradient(celebration.tier.key),
          color: style.on,
          boxShadow: `0 0 0 4px ${style.accent}22`,
        }}
        initial={reduced ? false : { scale: 0.6, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={reduced ? transition.tap : { type: 'spring', stiffness: 520, damping: 18 }}
      >
        {celebration.to}
      </motion.span>
    </span>
  )
}
