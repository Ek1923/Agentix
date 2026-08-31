import type { DayKey } from '../../../core/dates'
import type { Bucket, Task, TimeSession } from '../../../core/db/types'
import { median } from '../../../core/stats'

/**
 * Delivery metrics. Pure functions, no React, no Dexie — the Swift build
 * translates this file directly.
 *
 * Scope, so this does not become Backtest: **Backtest asks how accurate you
 * were** (estimate versus actual, completion rate). **Flow asks how work moves** —
 * how long it takes to get out, how much is open at once, and where it stops.
 *
 * Every metric returns null rather than zero when there is nothing to measure.
 * A new board has no lead time; showing "0 days" would be a claim, and a false one.
 */

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** No session in this long, on work already started, counts as stalled. */
export const STALL_DAYS = 3

export interface FlowInput {
  tasks: Task[]
  sessions: TimeSession[]
  buckets: Bucket[]
  today: DayKey
  nowIso: string
}

function parse(iso: string | null): number | null {
  if (iso === null) return null
  const value = Date.parse(iso)
  return Number.isNaN(value) ? null : value
}

/**
 * Created to finished, in hours. The full wait a request experiences, including
 * every day it sat untouched — which is what someone waiting on you actually feels.
 */
export function leadTimeHours(task: Task): number | null {
  const created = parse(task.createdAt)
  const completed = parse(task.completedAt)
  if (created === null || completed === null) return null
  return Math.max(0, (completed - created) / HOUR_MS)
}

/**
 * First touch to finished, in hours. How long a thing takes once it is actually
 * picked up — lead time minus the queue in front of it.
 */
export function cycleTimeHours(task: Task, sessions: TimeSession[]): number | null {
  const completed = parse(task.completedAt)
  if (completed === null) return null

  const starts = sessions
    .filter((s) => s.taskId === task.id)
    .map((s) => parse(s.startedAt))
    .filter((v): v is number => v !== null)
  if (starts.length === 0) return null

  return Math.max(0, (completed - Math.min(...starts)) / HOUR_MS)
}

/** Days since the last session touched this task. Null when never touched. */
export function daysSinceLastTouch(
  task: Task,
  sessions: TimeSession[],
  nowIso: string,
): number | null {
  const now = parse(nowIso)
  if (now === null) return null

  const touches = sessions
    .filter((s) => s.taskId === task.id)
    .map((s) => parse(s.endedAt ?? s.startedAt))
    .filter((v): v is number => v !== null)
  if (touches.length === 0) return null

  return Math.max(0, (now - Math.max(...touches)) / DAY_MS)
}

/**
 * Work that was started and then left. The most useful thing on this screen:
 * an untouched task is merely planned, but a stalled one is already paid for.
 *
 * A task with a running timer is never stalled, however long it has been open.
 */
export function findStalled(input: FlowInput): Array<{ task: Task; idleDays: number }> {
  const running = new Set(
    input.sessions.filter((s) => s.endedAt === null).map((s) => s.taskId),
  )

  return input.tasks
    .filter((task) => task.status !== 'done' && !running.has(task.id))
    .map((task) => ({
      task,
      idleDays: daysSinceLastTouch(task, input.sessions, input.nowIso) ?? -1,
    }))
    .filter((entry) => entry.idleDays >= STALL_DAYS)
    .sort((a, b) => b.idleDays - a.idleDays)
}

export interface BucketLoad {
  bucket: Bucket
  count: number
  /** Share of all open work sitting here, 0–100. Null when nothing is open. */
  share: number | null
}

/**
 * Where open work is piled up. Done columns are excluded: finished work is not
 * load, and counting it would make a productive week look congested.
 */
export function bucketLoad(input: FlowInput): BucketLoad[] {
  const open = input.tasks.filter((t) => t.status !== 'done')

  return input.buckets
    .filter((bucket) => bucket.impliesStatus !== 'done')
    .map((bucket) => {
      const count = open.filter((t) => t.bucketId === bucket.id).length
      return {
        bucket,
        count,
        share: open.length === 0 ? null : Math.round((count / open.length) * 100),
      }
    })
}

export interface FlowMetrics {
  /** Tasks finished inside the window. */
  completed: number
  /** Finished per day across the window, to one decimal. Null with no window. */
  throughputPerDay: number | null
  medianLeadHours: number | null
  medianCycleHours: number | null
  /** Open tasks right now, whatever day they are planned for. */
  wip: number
  /** Open tasks that have been started — work in flight, not merely listed. */
  started: number
  stalled: number
}

export function flowMetrics(input: FlowInput, windowDays: number): FlowMetrics {
  const done = input.tasks.filter((t) => t.status === 'done')
  const open = input.tasks.filter((t) => t.status !== 'done')

  const touched = new Set(input.sessions.map((s) => s.taskId))

  const leadTimes = done
    .map(leadTimeHours)
    .filter((v): v is number => v !== null)
  const cycleTimes = done
    .map((task) => cycleTimeHours(task, input.sessions))
    .filter((v): v is number => v !== null)

  return {
    completed: done.length,
    throughputPerDay:
      windowDays <= 0 ? null : Math.round((done.length / windowDays) * 10) / 10,
    medianLeadHours: median(leadTimes),
    medianCycleHours: median(cycleTimes),
    wip: open.length,
    started: open.filter((t) => touched.has(t.id)).length,
    stalled: findStalled(input).length,
  }
}

/** "3h", "2.5d" — hours below a day, days above, because nobody counts 74 hours. */
export function formatHours(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${Math.round(hours)}h`
  return `${Math.round((hours / 24) * 10) / 10}d`
}

/**
 * Tasks as CSV, for a spreadsheet or a BI tool.
 *
 * Offered because this is the honest end of "your data stays on your device": it
 * is only truly yours if you can take it somewhere else.
 */
export function tasksToCsv(input: FlowInput): string {
  const header = [
    'id',
    'title',
    'status',
    'bucket',
    'priority',
    'planned_for',
    'created_at',
    'completed_at',
    'estimate_min',
    'tracked_min',
    'lead_time_hours',
    'cycle_time_hours',
  ]

  const bucketNames = new Map(input.buckets.map((b) => [b.id, b.name]))

  const rows = input.tasks.map((task) => {
    const trackedMs = input.sessions
      .filter((s) => s.taskId === task.id)
      .reduce((total, s) => {
        const start = parse(s.startedAt)
        const end = parse(s.endedAt) ?? parse(input.nowIso)
        if (start === null || end === null) return total
        return total + Math.max(0, end - start)
      }, 0)

    const lead = leadTimeHours(task)
    const cycle = cycleTimeHours(task, input.sessions)

    return [
      task.id,
      task.title,
      task.status,
      bucketNames.get(task.bucketId) ?? '',
      String(task.priority),
      task.plannedFor,
      task.createdAt,
      task.completedAt ?? '',
      task.estimateMin === null ? '' : String(task.estimateMin),
      String(Math.round(trackedMs / 60_000)),
      lead === null ? '' : String(Math.round(lead * 10) / 10),
      cycle === null ? '' : String(Math.round(cycle * 10) / 10),
    ]
  })

  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

/**
 * Quotes a CSV field.
 *
 * A leading =, +, - or @ is prefixed with a quote as well: spreadsheets treat
 * those as formulas, so a task titled `=1+1` would execute rather than display.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`
  return guarded
}
