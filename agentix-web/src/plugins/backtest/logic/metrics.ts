import { localDayOf, shiftDay, type DayKey } from '../../../core/dates'
import type { Task, TimeSession } from '../../../core/db/types'
import { median } from '../../../core/stats'

/**
 * Backtest metrics. Pure functions, no React, no Dexie — the Swift build
 * translates this file directly.
 *
 * Nothing here is stored. Every figure is derived from Task and TimeSession on
 * demand, because a stored derivative goes stale the moment a task is edited.
 *
 * Scope, against the other two analysis plugins: **Backtest asks how accurate you
 * were.** Flow asks how work moves; Workload asks whether the plan fits.
 */

export type BacktestWindow = 5 | 10 | 15 | 20 | 30

export const WINDOWS: readonly BacktestWindow[] = [5, 10, 15, 20, 30]

/** Long enough to show a pattern, short enough to feel current. */
export const DEFAULT_WINDOW: BacktestWindow = 10

/** Within this much of the estimate counts as having got it right. */
export const ACCURACY_TOLERANCE = 0.2

/** Below this, tracked time on a task is a mis-click, not evidence of effort. */
export const MIN_TRACKED_MINUTES = 2

const MINUTE_MS = 60_000

function parse(iso: string | null): number | null {
  if (iso === null) return null
  const value = Date.parse(iso)
  return Number.isNaN(value) ? null : value
}

function durationMinutes(session: TimeSession, nowIso: string): number {
  const start = parse(session.startedAt)
  const end = parse(session.endedAt) ?? parse(nowIso)
  if (start === null || end === null) return 0
  return Math.max(0, (end - start) / MINUTE_MS)
}

export type ClockFormat = '24h' | '12h'

/** Local time, so a clock-in reads as the hour it felt like. */
export function clockLabel(iso: string | null, format: ClockFormat = '24h'): string | null {
  const at = parse(iso)
  if (at === null) return null
  const date = new Date(at)
  return formatClockParts(date.getHours(), date.getMinutes(), format)
}

/**
 * Formats an hour and minute.
 *
 * Midnight and noon are the cases a naive `hours % 12` gets wrong: both come out
 * as 0, and "0:30 AM" is not a time anybody writes.
 */
export function formatClockParts(
  hours: number,
  minutes: number,
  format: ClockFormat = '24h',
): string {
  const mm = String(minutes).padStart(2, '0')
  if (format === '24h') return `${String(hours).padStart(2, '0')}:${mm}`

  const suffix = hours < 12 ? 'AM' : 'PM'
  const twelve = hours % 12 === 0 ? 12 : hours % 12
  return `${twelve}:${mm} ${suffix}`
}

/** Minutes since local midnight — the x position of a clock time on a day bar. */
export function minutesIntoDay(iso: string | null): number | null {
  const at = parse(iso)
  if (at === null) return null
  const date = new Date(at)
  return date.getHours() * 60 + date.getMinutes()
}

/** The N days ending today, oldest first. */
export function windowDays(today: DayKey, window: BacktestWindow): DayKey[] {
  return Array.from({ length: window }, (_, i) => shiftDay(today, -(window - 1 - i)))
}

export interface DayMetrics {
  day: DayKey
  planned: number
  done: number
  /** done / planned, 0–100. Null when nothing was planned — not zero. */
  completionRate: number | null
  /** Tracked minutes. Null when nothing was tracked — not zero. */
  focusMinutes: number | null
  firstClockIn: string | null
  lastClockOut: string | null
  longestSessionMin: number | null
  /**
   * Whether this day has anything to say.
   *
   * A day with no data is drawn empty rather than as a zero: a flat line at zero
   * reads as failure when it only means the app was not in use.
   */
  hasData: boolean
}

/**
 * Per-day figures across the window.
 *
 * Sessions are attributed to the local day they *started*. A session running past
 * midnight counts wholly against the evening it began, which matches how someone
 * describes their own night better than splitting it at 00:00 would.
 */
export function buildDays(
  tasks: Task[],
  sessions: TimeSession[],
  days: DayKey[],
  nowIso: string,
): DayMetrics[] {
  const tasksByDay = new Map<DayKey, Task[]>()
  for (const task of tasks) {
    const list = tasksByDay.get(task.plannedFor)
    if (list) list.push(task)
    else tasksByDay.set(task.plannedFor, [task])
  }

  const sessionsByDay = new Map<DayKey, TimeSession[]>()
  for (const session of sessions) {
    const day = localDayOf(session.startedAt)
    const list = sessionsByDay.get(day)
    if (list) list.push(session)
    else sessionsByDay.set(day, [session])
  }

  return days.map((day) => {
    const dayTasks = tasksByDay.get(day) ?? []
    const daySessions = sessionsByDay.get(day) ?? []

    const planned = dayTasks.length
    const done = dayTasks.filter((t) => t.status === 'done').length

    const minutes = daySessions.map((s) => durationMinutes(s, nowIso))
    const focus = minutes.reduce((total, m) => total + m, 0)

    const starts = daySessions
      .map((s) => parse(s.startedAt))
      .filter((v): v is number => v !== null)
    const ends = daySessions
      .map((s) => parse(s.endedAt) ?? parse(nowIso))
      .filter((v): v is number => v !== null)

    const tracked = daySessions.length > 0 && focus > 0

    return {
      day,
      planned,
      done,
      completionRate: planned === 0 ? null : Math.round((done / planned) * 100),
      focusMinutes: tracked ? Math.round(focus) : null,
      firstClockIn: starts.length === 0 ? null : new Date(Math.min(...starts)).toISOString(),
      lastClockOut: ends.length === 0 ? null : new Date(Math.max(...ends)).toISOString(),
      longestSessionMin: minutes.length === 0 ? null : Math.round(Math.max(...minutes)),
      hasData: planned > 0 || tracked,
    }
  })
}

export type AccuracyVerdict = 'under' | 'accurate' | 'over'

export interface EstimatedTask {
  task: Task
  estimateMin: number
  actualMin: number
  /** actual / estimate. Above 1 means it took longer than guessed. */
  ratio: number
  deltaMin: number
  verdict: AccuracyVerdict
}

export function verdictFor(ratio: number): AccuracyVerdict {
  if (ratio > 1 + ACCURACY_TOLERANCE) return 'over'
  if (ratio < 1 - ACCURACY_TOLERANCE) return 'under'
  return 'accurate'
}

/**
 * Finished tasks that can actually be scored.
 *
 * A task needs an estimate *and* real tracked time. Scoring an unestimated task
 * as zero, or a never-tracked one as instant, would invent accuracy the data does
 * not contain — and the sample size is reported so a verdict from three tasks is
 * visibly a verdict from three tasks.
 */
export function scoreEstimates(
  tasks: Task[],
  sessions: TimeSession[],
  nowIso: string,
): EstimatedTask[] {
  const minutesByTask = new Map<string, number>()
  for (const session of sessions) {
    minutesByTask.set(
      session.taskId,
      (minutesByTask.get(session.taskId) ?? 0) + durationMinutes(session, nowIso),
    )
  }

  return tasks
    .filter((task) => task.status === 'done' && task.estimateMin !== null)
    .map((task) => {
      const actualMin = Math.round(minutesByTask.get(task.id) ?? 0)
      const estimateMin = task.estimateMin!
      return {
        task,
        estimateMin,
        actualMin,
        ratio: estimateMin === 0 ? 0 : actualMin / estimateMin,
        deltaMin: actualMin - estimateMin,
        verdict: verdictFor(estimateMin === 0 ? 0 : actualMin / estimateMin),
      }
    })
    .filter((scored) => scored.actualMin >= MIN_TRACKED_MINUTES && scored.estimateMin > 0)
}

export interface Accuracy {
  scored: EstimatedTask[]
  /** How many finished tasks could not be scored, and why it matters. */
  unscorable: number
  under: number
  accurate: number
  over: number
  medianRatio: number | null
  medianDeltaMin: number | null
}

export function summariseAccuracy(
  tasks: Task[],
  sessions: TimeSession[],
  nowIso: string,
): Accuracy {
  const scored = scoreEstimates(tasks, sessions, nowIso)
  const finished = tasks.filter((t) => t.status === 'done').length

  return {
    scored,
    unscorable: Math.max(0, finished - scored.length),
    under: scored.filter((s) => s.verdict === 'under').length,
    accurate: scored.filter((s) => s.verdict === 'accurate').length,
    over: scored.filter((s) => s.verdict === 'over').length,
    medianRatio: median(scored.map((s) => s.ratio)),
    medianDeltaMin: median(scored.map((s) => s.deltaMin)),
  }
}

export interface BacktestSummary {
  days: DayMetrics[]
  accuracy: Accuracy
  /** Days in the window that have anything recorded at all. */
  activeDays: number
  totalPlanned: number
  totalDone: number
  /** Across the whole window, 0–100. Null when nothing was planned. */
  completionRate: number | null
  totalFocusMinutes: number
  /** Typical focus on a day that had any — untracked days are excluded. */
  medianFocusMinutes: number | null
  longestSessionMin: number | null
  earliestClockIn: string | null
  latestClockOut: string | null
}

export function summarise(
  tasks: Task[],
  sessions: TimeSession[],
  days: DayKey[],
  nowIso: string,
): BacktestSummary {
  const dayMetrics = buildDays(tasks, sessions, days, nowIso)

  const totalPlanned = dayMetrics.reduce((total, d) => total + d.planned, 0)
  const totalDone = dayMetrics.reduce((total, d) => total + d.done, 0)

  const focusValues = dayMetrics
    .map((d) => d.focusMinutes)
    .filter((v): v is number => v !== null)

  const clockIns = dayMetrics
    .map((d) => minutesIntoDay(d.firstClockIn))
    .filter((v): v is number => v !== null)
  const clockOuts = dayMetrics
    .map((d) => minutesIntoDay(d.lastClockOut))
    .filter((v): v is number => v !== null)

  const longest = dayMetrics
    .map((d) => d.longestSessionMin)
    .filter((v): v is number => v !== null)

  return {
    days: dayMetrics,
    accuracy: summariseAccuracy(tasks, sessions, nowIso),
    activeDays: dayMetrics.filter((d) => d.hasData).length,
    totalPlanned,
    totalDone,
    completionRate: totalPlanned === 0 ? null : Math.round((totalDone / totalPlanned) * 100),
    totalFocusMinutes: focusValues.reduce((total, m) => total + m, 0),
    medianFocusMinutes: median(focusValues),
    longestSessionMin: longest.length === 0 ? null : Math.max(...longest),
    earliestClockIn: clockIns.length === 0 ? null : formatMinutesOfDay(Math.min(...clockIns)),
    latestClockOut: clockOuts.length === 0 ? null : formatMinutesOfDay(Math.max(...clockOuts)),
  }
}

export function formatMinutesOfDay(minutes: number, format: ClockFormat = '24h'): string {
  return formatClockParts(Math.floor(minutes / 60) % 24, Math.round(minutes) % 60, format)
}

/** "2h 30m", "45m", or a dash — never a zero standing in for no data. */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—'
  const rounded = Math.round(minutes)
  if (rounded < 60) return `${rounded}m`

  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value}%`
}

/** "took 30% longer than estimated", from the median ratio. */
export function describeRatio(ratio: number | null): string | null {
  if (ratio === null) return null
  const off = Math.round(Math.abs(ratio - 1) * 100)
  if (off <= ACCURACY_TOLERANCE * 100) return 'Estimates are about right.'
  return ratio > 1
    ? `Work takes about ${off}% longer than estimated.`
    : `Work takes about ${off}% less than estimated.`
}
