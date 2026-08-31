import { motion } from 'framer-motion'
import type { Accuracy } from '../logic/metrics'
import { describeRatio, formatMinutes } from '../logic/metrics'

interface AccuracyBarProps {
  accuracy: Accuracy
}

/**
 * Estimate accuracy as a diverging measure: under ← accurate → over.
 *
 * Two hues with a neutral grey midpoint, never a third hue in the middle. The
 * chart colours are their own tokens, re-stepped from the ink hues into the
 * band a filled mark needs and validated for colour-vision deficiency — the two
 * poles separate by ΔE 25 under protanopia.
 *
 * Every segment also carries a text label, so identity is never colour alone.
 */
export function AccuracyBar({ accuracy }: AccuracyBarProps) {
  const total = accuracy.scored.length

  const segments = [
    { id: 'under', label: 'Faster', count: accuracy.under, className: 'bg-chart-under' },
    { id: 'accurate', label: 'On target', count: accuracy.accurate, className: 'bg-chart-accurate' },
    { id: 'over', label: 'Slower', count: accuracy.over, className: 'bg-chart-over' },
  ]

  return (
    <section className="card rounded-2xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Estimate accuracy</h3>
        <p className="text-xs text-muted">
          {total === 0
            ? 'Nothing scorable yet'
            : `${total} finished task${total === 1 ? '' : 's'} with an estimate and tracked time`}
        </p>
      </div>

      {total === 0 ? (
        <p className="mt-4 text-xs text-muted">
          A task can only be scored if it was finished, carried an estimate, and had
          the timer run on it. Nothing in this window qualifies yet.
        </p>
      ) : (
        <>
          <div className="mt-4 flex h-3 gap-[2px] overflow-hidden rounded-full">
            {segments
              .filter((segment) => segment.count > 0)
              .map((segment) => (
                <motion.div
                  key={segment.id}
                  className={`h-full ${segment.className}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${(segment.count / total) * 100}%` }}
                  transition={{ type: 'spring', stiffness: 180, damping: 26 }}
                  title={`${segment.label}: ${segment.count}`}
                />
              ))}
          </div>

          {/* The legend is always present, and each entry is directly labelled. */}
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {segments.map((segment) => (
              <li key={segment.id} className="flex items-center gap-1.5 text-xs">
                <span
                  className={`size-2.5 shrink-0 rounded-full ${segment.className}`}
                  aria-hidden
                />
                <span className="text-muted">{segment.label}</span>
                <span className="font-medium tabular-nums text-ink">{segment.count}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 border-t border-line pt-3 text-sm text-ink">
            {describeRatio(accuracy.medianRatio)}
            {accuracy.medianDeltaMin !== null && accuracy.medianDeltaMin !== 0 && (
              <span className="ml-1 text-xs text-muted">
                Typically {accuracy.medianDeltaMin > 0 ? '+' : '−'}
                {formatMinutes(Math.abs(accuracy.medianDeltaMin))} against the guess.
              </span>
            )}
          </p>
        </>
      )}

      {accuracy.unscorable > 0 && (
        <p className="mt-2 text-[11px] text-muted">
          {accuracy.unscorable} finished task{accuracy.unscorable === 1 ? '' : 's'} could not
          be scored — no estimate, or the timer never ran.
        </p>
      )}
    </section>
  )
}
