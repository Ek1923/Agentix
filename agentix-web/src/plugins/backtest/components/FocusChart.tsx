import { motion } from 'framer-motion'
import { format, parseISO } from 'date-fns'
import type { DayMetrics } from '../logic/metrics'
import { formatMinutes } from '../logic/metrics'

interface FocusChartProps {
  days: DayMetrics[]
}

/**
 * Tracked minutes per day.
 *
 * Bars rather than a line, deliberately: a line interpolates across a day with no
 * data, inventing a value for a day the app was not used. Bars leave that day
 * visibly empty, which is the honest reading.
 */
export function FocusChart({ days }: FocusChartProps) {
  const values = days.map((d) => d.focusMinutes ?? 0)
  const peak = Math.max(60, ...values)

  return (
    <section className="card rounded-2xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Focus time</h3>
        <p className="text-xs text-muted">Tracked minutes per day · peak {formatMinutes(peak)}</p>
      </div>

      <div className="mt-4 flex h-32 items-end gap-[2px]" role="presentation">
        {days.map((day) => {
          const minutes = day.focusMinutes
          const height = minutes === null ? 0 : Math.max(3, (minutes / peak) * 100)

          return (
            <div
              key={day.day}
              className="group relative flex h-full flex-1 items-end"
              // The hover layer: a chart in a browser is interactive by default.
              title={
                minutes === null
                  ? `${format(parseISO(day.day), 'EEE d MMM')} · nothing tracked`
                  : `${format(parseISO(day.day), 'EEE d MMM')} · ${formatMinutes(minutes)}`
              }
            >
              {minutes === null ? (
                // An empty day is drawn as a hairline on the baseline, not a zero bar.
                <div className="h-px w-full rounded-full bg-chart-grid" aria-hidden />
              ) : (
                <motion.div
                  className="w-full rounded-t bg-accent"
                  initial={{ height: 0 }}
                  animate={{ height: `${height}%` }}
                  transition={{ type: 'spring', stiffness: 180, damping: 26 }}
                />
              )}

              <span className="pointer-events-none absolute -top-6 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] font-medium text-surface group-hover:block">
                {minutes === null ? 'none' : formatMinutes(minutes)}
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex justify-between text-[10px] text-muted">
        <span>{format(parseISO(days[0]?.day ?? ''), 'd MMM')}</span>
        <span>{format(parseISO(days[days.length - 1]?.day ?? ''), 'd MMM')}</span>
      </div>
    </section>
  )
}
