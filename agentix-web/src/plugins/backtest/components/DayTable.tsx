import { format, parseISO } from 'date-fns'
import { clockLabel, formatMinutes, formatPercent, minutesIntoDay } from '../logic/metrics'
import type { DayMetrics } from '../logic/metrics'

interface DayTableProps {
  days: DayMetrics[]
}

const DAY_MINUTES = 24 * 60

/**
 * The clock-in / clock-out pattern, as a real table.
 *
 * A table rather than a chart-only view on purpose: it is the accessible reading
 * of the same data, it carries the exact numbers a chart can only approximate,
 * and the span bar sits inside a cell rather than replacing it.
 */
export function DayTable({ days }: DayTableProps) {
  const withData = days.filter((day) => day.hasData)

  return (
    <section className="card rounded-2xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Clock in, clock out</h3>
        <p className="text-xs text-muted">Days with nothing recorded are left out</p>
      </div>

      {withData.length === 0 ? (
        <p className="mt-4 text-xs text-muted">
          No tracked days in this window yet.
        </p>
      ) : (
        <div className="agentix-scroll mt-4 max-h-80 overflow-y-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              First clock-in, last clock-out, focus time and completion per day
            </caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted">
                <th scope="col" className="pb-2 font-semibold">
                  Day
                </th>
                <th scope="col" className="pb-2 font-semibold">
                  Span
                </th>
                <th scope="col" className="pb-2 text-right font-semibold">
                  In
                </th>
                <th scope="col" className="pb-2 text-right font-semibold">
                  Out
                </th>
                <th scope="col" className="pb-2 text-right font-semibold">
                  Focus
                </th>
                <th scope="col" className="pb-2 text-right font-semibold">
                  Done
                </th>
              </tr>
            </thead>
            <tbody>
              {withData.map((day) => {
                const start = minutesIntoDay(day.firstClockIn)
                const end = minutesIntoDay(day.lastClockOut)
                const hasSpan = start !== null && end !== null && end > start

                return (
                  <tr key={day.day} className="border-t border-line/70">
                    <th
                      scope="row"
                      className="whitespace-nowrap py-2 pr-3 text-xs font-medium text-ink"
                    >
                      {format(parseISO(day.day), 'EEE d MMM')}
                    </th>

                    <td className="py-2 pr-3">
                      <div className="relative h-1.5 w-full min-w-24 overflow-hidden rounded-full bg-surface">
                        {hasSpan && (
                          <div
                            className="absolute inset-y-0 rounded-full bg-accent"
                            style={{
                              left: `${(start / DAY_MINUTES) * 100}%`,
                              width: `${((end - start) / DAY_MINUTES) * 100}%`,
                            }}
                          />
                        )}
                      </div>
                    </td>

                    <td className="py-2 pr-3 text-right measure text-xs text-muted">
                      {clockLabel(day.firstClockIn) ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-right measure text-xs text-muted">
                      {clockLabel(day.lastClockOut) ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-right measure text-xs text-ink">
                      {formatMinutes(day.focusMinutes)}
                    </td>
                    <td className="py-2 text-right measure text-xs text-muted">
                      {day.planned === 0
                        ? '—'
                        : `${day.done}/${day.planned} · ${formatPercent(day.completionRate)}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
