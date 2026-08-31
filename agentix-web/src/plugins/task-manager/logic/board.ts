import type { Bucket, Task, TaskPatch } from '../../../core/db/types'
import { sortForDay } from './tasks'

/**
 * Board grouping over user-defined columns. Pure functions, no React, no Dexie —
 * the Swift build translates this file directly.
 *
 * Columns are data now, not an enum: they can be renamed, added and removed. What
 * keeps that safe is `Bucket.impliesStatus` — dropping a card into a column sets
 * the task's status to whatever the column means. Backtest counts completion by
 * status, so renaming "Done" to "Shipped" changes the label and nothing else.
 */

export type Board = Map<string, Task[]>

/**
 * Files every task into its column, and every column exists in the result even
 * when empty so columns never appear and vanish as work moves.
 *
 * A task whose bucket was deleted out from under it lands in the first column
 * rather than disappearing — losing a column must never lose work.
 */
export function groupIntoBuckets(tasks: Task[], buckets: Bucket[]): Board {
  const board: Board = new Map(buckets.map((b) => [b.id, [] as Task[]]))
  const fallback = buckets[0]

  for (const task of sortForDay(tasks)) {
    const column = board.get(task.bucketId)
    if (column) column.push(task)
    else if (fallback) board.get(fallback.id)!.push(task)
  }
  return board
}

export function tasksIn(board: Board, bucketId: string): Task[] {
  return board.get(bucketId) ?? []
}

/**
 * The patch that moves a task into a column, or null when it is already there.
 *
 * Returning null rather than a no-op patch matters: an identical write would still
 * bump `updatedAt`, and `updatedAt` is what drives sync conflict resolution. A
 * card dropped back where it started must not win a merge against a real edit
 * made on another device.
 */
export function moveToBucket(
  task: Task,
  bucket: Bucket,
  nowIso: string,
): TaskPatch | null {
  if (task.bucketId === bucket.id) return null

  const done = bucket.impliesStatus === 'done'
  return {
    bucketId: bucket.id,
    status: bucket.impliesStatus,
    // Entering a done column stamps the completion; leaving one clears the stamp,
    // so a reopened task does not keep claiming it was finished.
    completedAt: done ? nowIso : null,
  }
}

/** Which feedback an arrival in this column deserves. */
export function feedbackForBucket(bucket: Bucket): 'success' | 'light' {
  return bucket.impliesStatus === 'done' ? 'success' : 'light'
}

export interface BoardCounts {
  total: number
  done: number
  /** 0–100, for the progress bar in the header. */
  percentDone: number
}

export function countBoard(tasks: Task[]): BoardCounts {
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  return {
    total,
    done,
    percentDone: total === 0 ? 0 : Math.round((done / total) * 100),
  }
}

/** Trimmed, non-empty, and short enough to fit a column header. */
export function isValidBucketName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= 40
}
