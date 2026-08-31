import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Gauge, HelpCircle, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { dayLabel } from '../../core/dates'
import type { PluginContext } from '../../core/plugin-host/types'
import { EmptyState } from '../../ui/components/EmptyState'
import { PageHeader } from '../../ui/components/PageHeader'
import { SegmentedControl } from '../../ui/components/SegmentedControl'
import { transition } from '../../ui/tokens'
import { PersonChip } from '../task-manager/components/PersonChip'
import {
  formatMinutes,
  isOvercommitted,
  loadByPerson,
  measureCapacity,
  MIN_DAYS_FOR_CAPACITY,
  planAhead,
  summarise,
} from './logic/capacity'

const HORIZONS = [3, 7, 14] as const
type Horizon = (typeof HORIZONS)[number]

/** Looks back far enough that a median has something to work with. */
const CAPACITY_LOOKBACK_DAYS = 30

export function Workload({ ctx }: { ctx: PluginContext }) {
  const today = ctx.db.todayLocal()
  const [horizon, setHorizon] = useState<Horizon>(7)

  const people = useLiveQuery(() => ctx.db.listPeople(), [], [])

  // Ahead: today through the horizon. listRecentTasks only looks back, so the
  // forward range is asked for directly.
  const ahead = useLiveQuery(async () => {
    const last = new Date()
    last.setDate(last.getDate() + horizon)
    const month = String(last.getMonth() + 1).padStart(2, '0')
    const day = String(last.getDate()).padStart(2, '0')
    return ctx.db.listTasksInRange(today, `${last.getFullYear()}-${month}-${day}`)
  }, [today, horizon])

  // Behind: what capacity is measured from.
  const history = useLiveQuery(async () => {
    const past = await ctx.db.listRecentTasks(CAPACITY_LOOKBACK_DAYS)
    return ctx.db.listSessionsForTasks(past.map((t) => t.id))
  }, [], [])

  if (ahead === undefined) return null

  const nowIso = new Date().toISOString()
  const capacity = measureCapacity(history, nowIso)
  const plans = planAhead(ahead, today, horizon, capacity)
  const totals = summarise(plans)
  const perPerson = loadByPerson(plans, people)

  const maxMinutes = Math.max(
    capacity.medianMinutes ?? 0,
    ...plans.map((plan) => plan.plannedMinutes),
    1,
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Next ${horizon} days`}
        meta={
          totals.plannedMinutes > 0
            ? `${formatMinutes(totals.plannedMinutes)} planned over ${horizon} days`
            : `Nothing planned in the next ${horizon} days`
        }
        trailing={
          <SegmentedControl
            label="Horizon"
            value={horizon}
            segments={HORIZONS.map((option) => ({
              value: option,
              label: `${option}d`,
              ariaLabel: `Next ${option} days`,
            }))}
            onChange={setHorizon}
          />
        }
      />

      {/*
        Capacity is measured, never assumed. Until there is enough evidence this
        says so plainly rather than inventing an eight-hour day and grading the
        plan against a number nobody has ever hit.
      */}
      <section className="card rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 shrink-0 text-accent" aria-hidden />
          <h3 className="text-sm font-semibold text-ink">Your measured day</h3>
        </div>

        {capacity.medianMinutes === null ? (
          <div className="mt-2 flex items-start gap-2 text-xs text-muted">
            <HelpCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              Not enough tracked days yet — {capacity.measuredDays} of{' '}
              {MIN_DAYS_FOR_CAPACITY} needed. Run the timer on a few days and this
              becomes a real number instead of a guess.
            </p>
          </div>
        ) : (
          <p className="mt-1 text-sm text-ink">
            <span className="display measure text-[26px] leading-none">
              {formatMinutes(capacity.medianMinutes)}
            </span>{' '}
            <span className="text-xs text-muted">
              typical tracked day, from {capacity.measuredDays} measured days · best{' '}
              {formatMinutes(capacity.bestMinutes)}
            </span>
          </p>
        )}
      </section>

      {totals.overcommittedDays > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition.screen}
          className="flex items-start gap-2.5 rounded-2xl border border-warn/40 bg-warn/[0.05] p-4"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <p className="text-sm text-ink">
            {totals.overcommittedDays} day{totals.overcommittedDays === 1 ? '' : 's'}{' '}
            planned beyond what a typical day of yours has held.
            <span className="mt-0.5 block text-xs text-muted">
              Not a rule — just the arithmetic. Reconsider can move things out.
            </span>
          </p>
        </motion.div>
      )}

      <section className="flex flex-col gap-2">
        {plans.map((plan) => {
          const over = isOvercommitted(plan)
          const width = Math.min(100, (plan.plannedMinutes / maxMinutes) * 100)

          return (
            <div
              key={plan.day}
              className={`rounded-2xl border p-3.5 ${
                over ? 'border-warn/40 bg-warn/[0.04]' : 'border-line bg-raised'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-ink">
                  {dayLabel(plan.day, today)}
                </span>
                <span className="measure text-xs text-muted">
                  {plan.tasks.length === 0
                    ? 'free'
                    : `${plan.tasks.length} task${plan.tasks.length === 1 ? '' : 's'} · ${formatMinutes(plan.plannedMinutes)}`}
                  {plan.loadPercent !== null && plan.tasks.length > 0 && (
                    <span className={over ? ' text-warn' : ''}> · {plan.loadPercent}%</span>
                  )}
                </span>
              </div>

              {plan.tasks.length > 0 && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
                  <motion.div
                    className={`h-full rounded-full ${over ? 'bg-warn' : 'bg-accent'}`}
                    initial={false}
                    animate={{ width: `${width}%` }}
                    transition={{ type: 'spring', stiffness: 200, damping: 30 }}
                  />
                </div>
              )}

              {plan.unestimated > 0 && (
                <p className="mt-1.5 text-[11px] text-muted">
                  {plan.unestimated} without an estimate — this day may be heavier
                  than it looks.
                </p>
              )}
            </div>
          )
        })}
      </section>

      {perPerson.length > 0 && (
        <section className="card rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-ink">On each plate</h3>
          <p className="mt-0.5 text-xs text-muted">
            A task tagged with several people counts for each of them.
          </p>

          <ul className="mt-3 flex flex-col gap-2">
            {perPerson.map((load) => (
              <li key={load.person.id} className="flex items-center gap-3">
                <PersonChip person={load.person} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {load.person.name}
                </span>
                <span className="shrink-0 measure text-xs text-muted">
                  {load.taskCount} · {formatMinutes(load.plannedMinutes)}
                  {load.unestimated > 0 && ` · ${load.unestimated} unsized`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {totals.plannedMinutes === 0 && totals.unestimated === 0 && (
        <EmptyState
          icon={<Gauge className="size-8" aria-hidden />}
          title="The road ahead is clear."
          body="Nothing is planned for the next few days. Add work in Task Manager and this fills in."
        />
      )}
    </div>
  )
}
