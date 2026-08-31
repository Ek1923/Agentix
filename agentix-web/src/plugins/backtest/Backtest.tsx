import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart3 } from 'lucide-react'
import { useMemo } from 'react'
import { windowDays as buildWindow } from './logic/metrics'
import type { PluginContext } from '../../core/plugin-host/types'
import { useSettings } from '../../core/settings/store'
import { EmptyState } from '../../ui/components/EmptyState'
import { PageHeader } from '../../ui/components/PageHeader'
import { SegmentedControl } from '../../ui/components/SegmentedControl'
import { Stat, StatGrid } from '../../ui/components/Stat'
import { AccuracyBar } from './components/AccuracyBar'
import { DayTable } from './components/DayTable'
import { FocusChart } from './components/FocusChart'
import {
  formatMinutes,
  formatPercent,
  summarise,
  WINDOWS,
  type BacktestWindow,
} from './logic/metrics'

/** The widest window. Everything is fetched once at this size and sliced in memory. */
const MAX_WINDOW = 30

export function Backtest({ ctx }: { ctx: PluginContext }) {
  const today = ctx.db.todayLocal()
  const window = useSettings((s) => s.backtestWindow)
  const setWindow = useSettings((s) => s.setBacktestWindow)

  /*
    Fetched once at the widest window, with no dependency on the selected one.
    Changing the window re-slices this in memory rather than going back to the
    database — which is the brief's requirement, and the reason nothing derived
    is ever stored: it is cheap enough to recompute.
  */
  const tasks = useLiveQuery(() => ctx.db.listRecentTasks(MAX_WINDOW), [])
  const sessions = useLiveQuery(
    async () => {
      const from = new Date()
      from.setDate(from.getDate() - MAX_WINDOW)
      return ctx.db.listSessionsInRange(from.toISOString(), new Date().toISOString())
    },
    [],
    [],
  )

  const summary = useMemo(() => {
    if (tasks === undefined) return null
    const days = buildWindow(today, window)
    const first = days[0]!
    return summarise(
      tasks.filter((task) => task.plannedFor >= first),
      sessions,
      days,
      new Date().toISOString(),
    )
  }, [tasks, sessions, today, window])

  if (tasks === undefined || summary === null) return null

  const nothingRecorded = summary.activeDays === 0

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Last ${window} days`}
        meta={`${summary.activeDays} of ${window} days had something recorded`}
        trailing={
          <SegmentedControl
            label="Window"
            value={window}
            segments={WINDOWS.map((option: BacktestWindow) => ({
              value: option,
              label: String(option),
              ariaLabel: `Last ${option} days`,
            }))}
            onChange={setWindow}
          />
        }
      />

      {nothingRecorded ? (
        <EmptyState
          icon={<BarChart3 className="size-8" aria-hidden />}
          title="Nothing recorded in this window."
          body={`No tasks planned and no time tracked in the last ${window} days. Backtest reports what happened — it fills in as you use the board.`}
        />
      ) : (
        <>
          <StatGrid>
            <Stat
              label="Completed"
              value={formatPercent(summary.completionRate)}
              hint={`${summary.totalDone} of ${summary.totalPlanned} planned`}
            />
            <Stat
              label="Focus"
              value={formatMinutes(summary.totalFocusMinutes)}
              hint={`${formatMinutes(summary.medianFocusMinutes)} on a typical day`}
            />
            <Stat
              label="Longest run"
              value={formatMinutes(summary.longestSessionMin)}
              hint="unbroken session"
            />
            <Stat
              label="Working hours"
              value={
                summary.earliestClockIn === null
                  ? '—'
                  : `${summary.earliestClockIn}–${summary.latestClockOut}`
              }
              hint="earliest in, latest out"
            />
          </StatGrid>

          <FocusChart days={summary.days} />
          <AccuracyBar accuracy={summary.accuracy} />
          <DayTable days={summary.days} />
        </>
      )}
    </div>
  )
}
