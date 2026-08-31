import { localDayOf, shiftDay, type DayKey } from '../../../core/dates'
import type { Person, Task, TimeSession } from '../../../core/db/types'
import { groupBy, median } from '../../../core/stats'

/**
 * Capacity planning. Pure functions, no React, no Dexie — the Swift build
 * translates this file directly.
 *
 * Scope, so this does not become Backtest or Flow: **Backtest looks back at how
 * accurate you were. Flow looks at how work moves. Workload looks forward** — is
 * what is planned actually deliverable, given what you have proven you deliver?
 *
 * The rule that governs everything here: **capacity is measured, never assumed.**
 * There is no eight-hour default. Until enough days have been tracked, this
 * screen says it does not know rather than inventing a number.
 */

/** Below this, a tracked day is a stray click rather than a day of work. */
export const MIN_TRACKED_MINUTES = 10

/** Fewer measured days than this and a median is not yet worth trusting. */
export const MIN_DAYS_FOR_CAPACITY = 3

function parse(iso: string | null): number | null {
  if (iso === null) return null
  const value = Date.parse(iso)
  return Number.isNaN(value) ? null : value
}

/** The local calendar day a session started on. */
export function sessionDay(session: TimeSession): DayKey {
  return localDayOf(session.startedAt)
}

export function sessionMinutes(session: TimeSession, nowIso: string): number {
  const start = parse(session.startedAt)
  const end = parse(session.endedAt) ?? parse(nowIso)
  if (start === null || end === null) return 0
  return Math.max(0, (end - start) / 60_000)
}

/**
 * Tracked minutes per day that had any real work on it.
 *
 * Days with nothing tracked are left out rather than counted as zero. A weekend
 * is not evidence that you can do no work; it is an absence of evidence, and
 * including it would halve every capacity figure.
 */
export function trackedMinutesByDay(
  sessions: TimeSession[],
  nowIso: string,
): Map<DayKey, number> {
  const byDay = new Map<DayKey, number>()
  for (const session of sessions) {
    const day = sessionDay(session)
    byDay.set(day, (byDay.get(day) ?? 0) + sessionMinutes(session, nowIso))
  }

  for (const [day, minutes] of byDay) {
    if (minutes < MIN_TRACKED_MINUTES) byDay.delete(day)
  }
  return byDay
}

export interface Capacity {
  /** Median tracked minutes on a working day. Null until there is enough data. */
  medianMinutes: number | null
  /** How many days the figure is based on. */
  measuredDays: number
  /** The best day observed, for context on what a stretch looks like. */
  bestMinutes: number | null
}

export function measureCapacity(sessions: TimeSession[], nowIso: string): Capacity {
  const byDay = trackedMinutesByDay(sessions, nowIso)
  const minutes = [...byDay.values()]

  return {
    medianMinutes: minutes.length >= MIN_DAYS_FOR_CAPACITY ? median(minutes) : null,
    measuredDays: minutes.length,
    bestMinutes: minutes.length === 0 ? null : Math.max(...minutes),
  }
}

export interface DayPlan {
  day: DayKey
  tasks: Task[]
  /** Summed estimates, in minutes. Only counts tasks that carry one. */
  plannedMinutes: number
  /** Planned tasks with no estimate — work that cannot be weighed. */
  unestimated: number
  /**
   * Planned minutes as a share of measured capacity, or null when capacity is
   * unknown. Above 100 means more is planned than a typical day has held.
   */
  loadPercent: number | null
}

/**
 * The days ahead, starting today.
 *
 * Finished tasks are excluded: they are no longer load. Days with nothing planned
 * are still returned, so an empty Thursday is visible as room rather than absent.
 */
export function planAhead(
  tasks: Task[],
  today: DayKey,
  days: number,
  capacity: Capacity,
): DayPlan[] {
  const open = tasks.filter((task) => task.status !== 'done')
  const byDay = groupBy(open, (task) => task.plannedFor)

  return Array.from({ length: days }, (_, offset) => {
    const day = shiftDay(today, offset)
    const dayTasks = byDay.get(day) ?? []

    const plannedMinutes = dayTasks.reduce((total, task) => total + (task.estimateMin ?? 0), 0)
    const unestimated = dayTasks.filter((task) => task.estimateMin === null).length

    return {
      day,
      tasks: dayTasks,
      plannedMinutes,
      unestimated,
      loadPercent:
        capacity.medianMinutes === null || capacity.medianMinutes === 0
          ? null
          : Math.round((plannedMinutes / capacity.medianMinutes) * 100),
    }
  })
}

/** A day planned well beyond what a typical day has actually held. */
export function isOvercommitted(plan: DayPlan): boolean {
  return plan.loadPercent !== null && plan.loadPercent > 100
}

export interface PersonLoad {
  person: Person
  taskCount: number
  plannedMinutes: number
  unestimated: number
}

/**
 * Open work ahead, per tagged person.
 *
 * A task tagged with three people counts once for each of them: this answers
 * "what is on your plate", not "how is the total divided".
 */
export function loadByPerson(plans: DayPlan[], people: Person[]): PersonLoad[] {
  const tasks = plans.flatMap((plan) => plan.tasks)

  return people
    .map((person) => {
      const theirs = tasks.filter((task) => task.assigneeIds.includes(person.id))
      return {
        person,
        taskCount: theirs.length,
        plannedMinutes: theirs.reduce((total, task) => total + (task.estimateMin ?? 0), 0),
        unestimated: theirs.filter((task) => task.estimateMin === null).length,
      }
    })
    .filter((load) => load.taskCount > 0)
    // Heaviest first; on a tie, more separate tasks means more switching, so it
    // leads. Name is the final tiebreak so the order cannot wobble between renders.
    .sort(
      (a, b) =>
        b.plannedMinutes - a.plannedMinutes ||
        b.taskCount - a.taskCount ||
        a.person.name.localeCompare(b.person.name),
    )
}

export interface WorkloadSummary {
  plannedMinutes: number
  unestimated: number
  overcommittedDays: number
  /** Days ahead with nothing planned at all. */
  freeDays: number
}

export function summarise(plans: DayPlan[]): WorkloadSummary {
  return {
    plannedMinutes: plans.reduce((total, plan) => total + plan.plannedMinutes, 0),
    unestimated: plans.reduce((total, plan) => total + plan.unestimated, 0),
    overcommittedDays: plans.filter(isOvercommitted).length,
    freeDays: plans.filter((plan) => plan.tasks.length === 0).length,
  }
}

/** "2h 30m", "45m", or a dash when there is nothing to show. */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—'
  const rounded = Math.round(minutes)
  if (rounded < 60) return `${rounded}m`

  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`
}
