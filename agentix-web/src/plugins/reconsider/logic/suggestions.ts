import { shiftDay, type DayKey } from '../../../core/dates'
import type { Task, TimeSession } from '../../../core/db/types'
import { totalDurationMs } from '../../task-manager/logic/time'

/**
 * Turns unfinished work into suggestions. Pure functions, no React, no Dexie —
 * the Swift build translates this file directly.
 *
 * The rule that governs everything here: **every suggestion is derived from data
 * that exists**. Each one carries the numbers it was built from, so the reason
 * shown to the user is the actual evidence rather than a generated sentence. If a
 * signal cannot be measured, there is no suggestion for it.
 */

export type SuggestionKind =
  | 'resume' // already worked on, never finished
  | 'reschedule' // planned, never started, still recent
  | 'drop' // open a long time with nothing invested

export interface Suggestion {
  taskId: string
  kind: SuggestionKind
  /** How many days past its planned day the task is. Always at least 1. */
  daysOverdue: number
  /** Minutes already tracked against it. Zero means never started. */
  trackedMin: number
  /** Higher sorts first. */
  score: number
}

/** Below this, tracked time is a mis-click rather than real work. */
export const MEANINGFUL_MINUTES = 2

/** Open this long with nothing invested is a signal the task is not happening. */
export const STALE_DAYS = 14

export function daysBetween(from: DayKey, to: DayKey): number {
  const start = Date.parse(`${from}T00:00:00`)
  const end = Date.parse(`${to}T00:00:00`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.round((end - start) / 86_400_000)
}

/** Open work whose planned day has already passed. */
export function isOverdue(task: Task, today: DayKey): boolean {
  return task.status !== 'done' && task.plannedFor < today
}

function classify(daysOverdue: number, trackedMin: number): SuggestionKind {
  // Work already started outranks everything: the time is spent either way, and
  // finishing is cheaper than starting over.
  if (trackedMin >= MEANINGFUL_MINUTES) return 'resume'
  if (daysOverdue >= STALE_DAYS) return 'drop'
  return 'reschedule'
}

/**
 * Ordering, most deserving of attention first.
 *
 * Started work leads, because abandoning it wastes something real. Then fresh
 * misses, which are still likely to matter. Stale untouched work sinks — it is
 * offered for dropping, not for guilt.
 */
function scoreOf(
  kind: SuggestionKind,
  daysOverdue: number,
  trackedMin: number,
  priority: number,
): number {
  const priorityWeight = priority * 8

  if (kind === 'resume') return 1000 + trackedMin + priorityWeight
  if (kind === 'reschedule') return 500 + priorityWeight - daysOverdue
  return 100 + daysOverdue
}

/**
 * Builds the suggestion list from tasks and their sessions.
 *
 * Finished tasks, future tasks and today's tasks produce nothing: a task planned
 * for today has not been missed yet, and nagging about it would train the user to
 * ignore this screen.
 */
export function buildSuggestions(
  tasks: Task[],
  sessions: TimeSession[],
  today: DayKey,
  nowIso: string,
): Suggestion[] {
  const minutesByTask = new Map<string, number>()
  for (const session of sessions) {
    const current = minutesByTask.get(session.taskId) ?? 0
    minutesByTask.set(
      session.taskId,
      current + totalDurationMs([session], nowIso) / 60_000,
    )
  }

  const suggestions: Suggestion[] = []
  for (const task of tasks) {
    if (!isOverdue(task, today)) continue

    const daysOverdue = Math.max(1, daysBetween(task.plannedFor, today))
    const trackedMin = Math.round(minutesByTask.get(task.id) ?? 0)
    const kind = classify(daysOverdue, trackedMin)

    suggestions.push({
      taskId: task.id,
      kind,
      daysOverdue,
      trackedMin,
      score: scoreOf(kind, daysOverdue, trackedMin, task.priority),
    })
  }

  return suggestions.sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId))
}

/**
 * The sentence shown under a suggestion.
 *
 * Built from the suggestion's own measured fields, so it can only ever state
 * something true. Nothing here is inferred or invented.
 */
export function reasonFor(suggestion: Suggestion): string {
  const { kind, daysOverdue, trackedMin } = suggestion
  const days = `${daysOverdue} day${daysOverdue === 1 ? '' : 's'}`

  if (kind === 'resume') {
    const time =
      trackedMin >= 60
        ? `${Math.floor(trackedMin / 60)}h ${String(trackedMin % 60).padStart(2, '0')}m`
        : `${trackedMin}m`
    return `${time} already tracked, then it stalled ${days} ago.`
  }

  if (kind === 'drop') {
    return `Open ${days} past its day and never started.`
  }

  return `Planned ${days} ago and never started.`
}

export const KIND_LABELS: Record<SuggestionKind, string> = {
  resume: 'Pick this back up',
  reschedule: 'Re-plan it',
  drop: 'Still worth doing?',
}

export interface SuggestionCounts {
  total: number
  resume: number
  reschedule: number
  drop: number
  /** Minutes already invested in work that was never finished. */
  strandedMin: number
}

export function countSuggestions(suggestions: Suggestion[]): SuggestionCounts {
  return {
    total: suggestions.length,
    resume: suggestions.filter((s) => s.kind === 'resume').length,
    reschedule: suggestions.filter((s) => s.kind === 'reschedule').length,
    drop: suggestions.filter((s) => s.kind === 'drop').length,
    strandedMin: suggestions.reduce((sum, s) => sum + s.trackedMin, 0),
  }
}

/** Where "move it forward" puts a task. Tomorrow, not today — today is often full. */
export function tomorrowOf(today: DayKey): DayKey {
  return shiftDay(today, 1)
}

/**
 * Suggestions grouped by what should happen to them.
 *
 * Bulk actions need this: "move everything I actually started to today" is one
 * decision, and making it twelve times is how a review screen stops getting used.
 */
export function groupByKind(suggestions: Suggestion[]): Record<SuggestionKind, Suggestion[]> {
  return {
    resume: suggestions.filter((s) => s.kind === 'resume'),
    reschedule: suggestions.filter((s) => s.kind === 'reschedule'),
    drop: suggestions.filter((s) => s.kind === 'drop'),
  }
}

/** What a bulk button offers for a group, or null when the group is empty. */
export function bulkActionFor(
  kind: SuggestionKind,
  count: number,
): { label: string; target: 'today' | 'tomorrow' } | null {
  if (count === 0) return null

  // Started work goes to today, because it is half done and finishing beats
  // deferring. Fresh misses go to tomorrow, because today is usually already full.
  if (kind === 'resume') return { label: `Finish all ${count} today`, target: 'today' }
  if (kind === 'reschedule') return { label: `Move all ${count} to tomorrow`, target: 'tomorrow' }
  return null
}
