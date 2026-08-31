import type { Task, TimeSession } from '../../../core/db/types'
import { median } from '../../../core/stats'

/**
 * Tag analysis. Pure functions, no React, no Dexie — the Swift build translates
 * this file directly.
 *
 * `Task.tags` has been in the locked schema since the start with nothing reading
 * it. This is what makes it worth carrying: time and completion per tag, which is
 * the closest thing the data has to a per-project or per-client breakdown.
 */

/** Lowercase, trimmed, no leading hash. Tags that differ only in case are one tag. */
export function normaliseTag(raw: string): string | null {
  const trimmed = raw.trim().replace(/^#+/, '').trim().toLowerCase()
  if (trimmed === '' || trimmed.length > 32) return null
  return trimmed
}

export function isValidTag(raw: string): boolean {
  return normaliseTag(raw) !== null
}

/** Adds a tag to a list without duplicating it. Returns the same list if present. */
export function addTag(tags: string[], raw: string): string[] {
  const tag = normaliseTag(raw)
  if (tag === null || tags.includes(tag)) return tags
  return [...tags, tag]
}

export function removeTagFrom(tags: string[], tag: string): string[] {
  return tags.filter((existing) => existing !== tag)
}

/** Every distinct tag across a set of tasks, most used first. */
export function collectTags(tasks: Task[]): string[] {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    for (const tag of task.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
}

export interface TagStats {
  tag: string
  taskCount: number
  doneCount: number
  /** 0–100, or null when nothing carries this tag. */
  completionRate: number | null
  trackedMinutes: number
  /** Typical minutes on a task with this tag, across tracked ones only. */
  medianMinutes: number | null
  estimatedMinutes: number
  /** How many tasks carry no estimate — what the planned figure is missing. */
  unestimated: number
}

function minutesByTask(sessions: TimeSession[], nowIso: string): Map<string, number> {
  const totals = new Map<string, number>()
  const now = Date.parse(nowIso)

  for (const session of sessions) {
    const start = Date.parse(session.startedAt)
    const end = session.endedAt === null ? now : Date.parse(session.endedAt)
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    totals.set(session.taskId, (totals.get(session.taskId) ?? 0) + Math.max(0, end - start) / 60_000)
  }
  return totals
}

/**
 * Per-tag figures.
 *
 * A task with three tags counts fully under each of them: this answers "how much
 * went into this tag", not "how does the total divide". Summing the columns will
 * therefore exceed the real total, which is why no total is shown.
 */
export function statsByTag(
  tasks: Task[],
  sessions: TimeSession[],
  nowIso: string,
): TagStats[] {
  const perTask = minutesByTask(sessions, nowIso)

  return collectTags(tasks).map((tag) => {
    const tagged = tasks.filter((task) => task.tags.includes(tag))
    const tracked = tagged
      .map((task) => perTask.get(task.id) ?? 0)
      .filter((minutes) => minutes > 0)

    return {
      tag,
      taskCount: tagged.length,
      doneCount: tagged.filter((task) => task.status === 'done').length,
      completionRate:
        tagged.length === 0
          ? null
          : Math.round((tagged.filter((t) => t.status === 'done').length / tagged.length) * 100),
      trackedMinutes: Math.round(tracked.reduce((total, m) => total + m, 0)),
      medianMinutes: tracked.length === 0 ? null : Math.round(median(tracked) ?? 0),
      estimatedMinutes: tagged.reduce((total, task) => total + (task.estimateMin ?? 0), 0),
      unestimated: tagged.filter((task) => task.estimateMin === null).length,
    }
  })
}

export type TagSort = 'time' | 'tasks' | 'name'

export function sortTagStats(stats: TagStats[], by: TagSort): TagStats[] {
  const sorted = [...stats]
  if (by === 'name') return sorted.sort((a, b) => a.tag.localeCompare(b.tag))
  if (by === 'tasks')
    return sorted.sort((a, b) => b.taskCount - a.taskCount || a.tag.localeCompare(b.tag))
  return sorted.sort((a, b) => b.trackedMinutes - a.trackedMinutes || a.tag.localeCompare(b.tag))
}

/** Tasks carrying no tag at all — the work that never gets attributed anywhere. */
export function untaggedCount(tasks: Task[]): number {
  return tasks.filter((task) => task.tags.length === 0).length
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—'
  const rounded = Math.round(minutes)
  if (rounded < 60) return `${rounded}m`
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`
}
