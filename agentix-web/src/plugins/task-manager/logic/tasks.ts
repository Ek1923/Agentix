import type { Task, TaskStatus, TimeSession } from '../../../core/db/types'
import { totalDurationMs, type SessionLike } from './time'

/**
 * Task ordering and grouping. Pure functions, no React, no Dexie — translated to
 * Swift as-is.
 */

/** Lower sorts first. Work in progress outranks everything; finished work sinks. */
const STATUS_RANK: Record<TaskStatus, number> = {
  active: 0,
  todo: 1,
  missed: 2,
  done: 3,
}

/**
 * Day order: what you are doing, then what you could do (most important first),
 * then what you missed, then what you finished. Ties break by creation order so
 * the list never reshuffles on its own while someone is reading it.
 */
export function sortForDay(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (byStatus !== 0) return byStatus

    const byPriority = b.priority - a.priority
    if (byPriority !== 0) return byPriority

    return a.createdAt.localeCompare(b.createdAt)
  })
}

export interface DaySummary {
  total: number
  done: number
  remaining: number
  trackedMs: number
}

export function summarize(
  tasks: Task[],
  sessions: SessionLike[],
  nowIso: string,
): DaySummary {
  const done = tasks.filter((t) => t.status === 'done').length
  return {
    total: tasks.length,
    done,
    remaining: tasks.length - done,
    trackedMs: totalDurationMs(sessions, nowIso),
  }
}

/** Sessions bucketed by task, so a day's rows each get their total in one pass. */
export function groupSessionsByTask(
  sessions: TimeSession[],
): Map<string, TimeSession[]> {
  const byTask = new Map<string, TimeSession[]>()
  for (const session of sessions) {
    const existing = byTask.get(session.taskId)
    if (existing) existing.push(session)
    else byTask.set(session.taskId, [session])
  }
  return byTask
}

/** A finished task should not accrue more time. Everything else is fair game. */
export function canTrack(task: Task): boolean {
  return task.status !== 'done'
}

/**
 * What a task's status becomes when it is ticked or un-ticked.
 *
 * Un-ticking returns it to `todo` rather than `active`: the timer is what makes a
 * task active, and reviving a task does not start its clock.
 */
export function toggledStatus(task: Task): TaskStatus {
  return task.status === 'done' ? 'todo' : 'done'
}

export const PRIORITY_LABELS: Record<0 | 1 | 2, string> = {
  0: 'Normal',
  1: 'High',
  2: 'Urgent',
}

export function isValidTitle(title: string): boolean {
  return title.trim().length > 0
}

/**
 * Parses the estimate field. Blank means "no estimate", which is different from
 * zero — see estimateDeltaMin. Rejects nonsense rather than storing NaN.
 */
export function parseEstimate(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value)
}
