import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Activity, Download, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { PluginContext } from '../../core/plugin-host/types'
import { EmptyState } from '../../ui/components/EmptyState'
import { PageHeader } from '../../ui/components/PageHeader'
import { SegmentedControl } from '../../ui/components/SegmentedControl'
import { Stat, StatGrid } from '../../ui/components/Stat'
import { backgroundCss, resolveBackground } from '../../ui/avatars'
import { feedback } from '../../ui/feedback'
import { transition } from '../../ui/tokens'
import { bucketLoad, findStalled, flowMetrics, formatHours, tasksToCsv } from './logic/flow'

const WINDOWS = [7, 14, 30] as const
type Window = (typeof WINDOWS)[number]

export function Flow({ ctx }: { ctx: PluginContext }) {
  const today = ctx.db.todayLocal()
  const [days, setDays] = useState<Window>(30)

  const tasks = useLiveQuery(() => ctx.db.listRecentTasks(days), [days])
  const buckets = useLiveQuery(() => ctx.db.listBuckets(), [], [])
  const sessions = useLiveQuery(
    async () => {
      const recent = await ctx.db.listRecentTasks(days)
      return ctx.db.listSessionsForTasks(recent.map((t) => t.id))
    },
    [days],
    [],
  )

  if (tasks === undefined) return null

  const input = { tasks, sessions, buckets, today, nowIso: new Date().toISOString() }
  const metrics = flowMetrics(input, days)
  const stalled = findStalled(input)
  const load = bucketLoad(input)
  const maxLoad = Math.max(1, ...load.map((l) => l.count))

  function exportCsv() {
    feedback('light')
    const blob = new Blob([tasksToCsv(input)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `agentix-tasks-${today}.csv`
    link.click()
    // Revoking immediately would cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Last ${days} days`}
        meta="How work moves: how fast it gets out, and where it stops"
        trailing={
          <div className="flex items-center gap-2">
            <SegmentedControl
              label="Window"
              value={days}
              segments={WINDOWS.map((window) => ({
                value: window,
                label: `${window}d`,
                ariaLabel: `Last ${window} days`,
              }))}
              onChange={setDays}
            />

            <button
              type="button"
              onClick={exportCsv}
              disabled={tasks.length === 0}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              <Download className="size-3.5" aria-hidden />
              CSV
            </button>
          </div>
        }
      />

      {tasks.length === 0 ? (
        <EmptyState
          icon={<Activity className="size-8" aria-hidden />}
          title="Nothing to measure yet."
          body={`No tasks in the last ${days} days. Flow reports on work that exists — it will fill in as you use the board.`}
        />
      ) : (
        <>
          <StatGrid>
            <Stat
              label="Finished"
              value={String(metrics.completed)}
              hint={
                metrics.throughputPerDay === null
                  ? undefined
                  : `${metrics.throughputPerDay}/day`
              }
            />
            <Stat
              label="Lead time"
              value={formatHours(metrics.medianLeadHours)}
              hint="median, created to done"
            />
            <Stat
              label="Cycle time"
              value={formatHours(metrics.medianCycleHours)}
              hint="median, first touch to done"
            />
            <Stat
              label="Open now"
              value={String(metrics.wip)}
              hint={`${metrics.started} started`}
            />
          </StatGrid>

          <section className="card rounded-2xl p-4">
            <h3 className="text-sm font-semibold text-ink">Where open work sits</h3>
            <p className="mt-0.5 text-xs text-muted">
              Done columns are left out — finished work is not load.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {load.map(({ bucket, count, share }) => (
                <div key={bucket.id} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs text-ink">
                    {bucket.name}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundImage: backgroundCss(resolveBackground(bucket.colorId)) }}
                      initial={false}
                      animate={{ width: `${(count / maxLoad) * 100}%` }}
                      transition={{ type: 'spring', stiffness: 200, damping: 30 }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right measure text-xs text-muted">
                    {count}
                    {share !== null && ` · ${share}%`}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {stalled.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={transition.screen}
              className="rounded-2xl border border-warn/40 bg-warn/[0.05] p-4"
            >
              <div className="flex items-center gap-2">
                <TriangleAlert className="size-4 shrink-0 text-warn" aria-hidden />
                <h3 className="text-sm font-semibold text-ink">
                  Started, then left ({stalled.length})
                </h3>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Work already paid for. An untouched task is only planned; this is
                stopped.
              </p>

              <ul className="mt-3 flex flex-col gap-2">
                {stalled.slice(0, 8).map(({ task, idleDays }) => (
                  <li
                    key={task.id}
                    className="flex items-center gap-3 rounded-xl bg-raised px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {task.title}
                    </span>
                    <span className="shrink-0 measure text-xs text-warn">
                      {Math.round(idleDays)}d idle
                    </span>
                  </li>
                ))}
              </ul>
            </motion.section>
          )}
        </>
      )}
    </div>
  )
}
