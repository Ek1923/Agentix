import type { SyncTable, Syncable } from '../db/types'

/**
 * Merge rules. Pure functions, no React, no Dexie, no network — the Swift build
 * translates this file directly, so both platforms resolve a conflict the same way.
 *
 * The rules come straight from the brief:
 *   - last write wins, compared by `updatedAt`
 *   - deletes are soft, so a delete merges like any other edit
 *   - running timers do not sync until they are closed
 */

export type Winner = 'local' | 'remote'

/**
 * Which version of a row survives, for the general last-write-wins rule.
 *
 * An exact tie resolves to remote, deterministically — two devices disagreeing
 * about a tie would ping-pong the row forever. `mergePull` handles a tie as a
 * no-op instead, because equal timestamps mean the two sides already agree.
 */
export function pickWinner(local: Syncable, remote: Syncable): Winner {
  return local.updatedAt > remote.updatedAt ? 'local' : 'remote'
}

/**
 * Whether a row may leave this device yet.
 *
 * A running timer is excluded: `endedAt: null` means the clock is still going,
 * and pushing it lets a second device see an open session it did not start and
 * close it, or start its own — producing two sessions for one stretch of work.
 * It goes out on the push after it is stopped.
 */
export function isPushable(table: SyncTable, row: Syncable): boolean {
  if (table !== 'sessions') return true
  return (row as Syncable & { endedAt: string | null }).endedAt !== null
}

export interface MergeDecision<T extends Syncable> {
  /** Rows from the server that should overwrite what is here. */
  apply: T[]
  /** Rows the server sent that this device already has a newer version of. */
  keptLocal: T[]
  /** Rows that arrived unchanged — same timestamp, nothing to do. */
  unchanged: T[]
}

/**
 * Decides what a pull changes.
 *
 * Three outcomes, and the third one matters more than it looks:
 *   - remote strictly newer  → apply
 *   - local strictly newer   → keep local, which is the real conflict
 *   - identical timestamps   → do nothing
 *
 * The cursor deliberately rewinds a millisecond on each pull, so the newest row
 * seen last time arrives again every sync. Treating that as "remote wins" would
 * rewrite an identical row on every pass, forever. Equal timestamps mean the two
 * sides already agree, and agreeing is not a change.
 */
export function mergePull<T extends Syncable>(
  localRows: T[],
  remoteRows: T[],
): MergeDecision<T> {
  const byId = new Map(localRows.map((row) => [row.id, row]))

  const apply: T[] = []
  const keptLocal: T[] = []
  const unchanged: T[] = []

  for (const remote of remoteRows) {
    const local = byId.get(remote.id)
    if (local === undefined) {
      apply.push(remote)
    } else if (remote.updatedAt > local.updatedAt) {
      apply.push(remote)
    } else if (remote.updatedAt < local.updatedAt) {
      keptLocal.push(remote)
    } else {
      unchanged.push(remote)
    }
  }

  return { apply, keptLocal, unchanged }
}

export interface PushBatch<T extends Syncable> {
  table: SyncTable
  rows: T[]
  /** Outbox entry ids that this batch covers, cleared only if the push succeeds. */
  entryIds: string[]
}

/**
 * Splits queued rows into what can go now and what has to wait.
 *
 * A held-back row keeps its outbox entry, so it goes out on a later push rather
 * than being dropped.
 */
export function splitPushable<T extends Syncable>(
  table: SyncTable,
  queued: Array<{ entryId: string; row: T }>,
): { batch: PushBatch<T>; held: string[] } {
  const ready = queued.filter(({ row }) => isPushable(table, row))
  const held = queued.filter(({ row }) => !isPushable(table, row)).map((q) => q.entryId)

  return {
    batch: {
      table,
      rows: ready.map((q) => q.row),
      entryIds: ready.map((q) => q.entryId),
    },
    held,
  }
}

/**
 * The high-water mark to ask the server for next time.
 *
 * One millisecond is subtracted so a row written in the same millisecond as the
 * newest one seen is not skipped. Re-fetching a row already held is harmless —
 * the merge above discards it — while skipping one loses an edit.
 */
export function nextCursor(previous: string, applied: Syncable[]): string {
  const newest = applied.reduce((max, row) => (row.updatedAt > max ? row.updatedAt : max), previous)
  if (newest === previous) return previous

  const parsed = Date.parse(newest)
  if (Number.isNaN(parsed)) return previous
  return new Date(parsed - 1).toISOString()
}

export interface SyncCounts {
  pushed: number
  pulled: number
  held: number
  conflicts: number
}

export function emptyCounts(): SyncCounts {
  return { pushed: 0, pulled: 0, held: 0, conflicts: 0 }
}

export function addCounts(a: SyncCounts, b: Partial<SyncCounts>): SyncCounts {
  return {
    pushed: a.pushed + (b.pushed ?? 0),
    pulled: a.pulled + (b.pulled ?? 0),
    held: a.held + (b.held ?? 0),
    conflicts: a.conflicts + (b.conflicts ?? 0),
  }
}

export function describeCounts(counts: SyncCounts): string {
  const parts: string[] = []
  if (counts.pushed > 0) parts.push(`${counts.pushed} sent`)
  if (counts.pulled > 0) parts.push(`${counts.pulled} received`)
  if (counts.conflicts > 0) parts.push(`${counts.conflicts} kept local`)
  if (counts.held > 0) parts.push(`${counts.held} waiting on a running timer`)

  return parts.length === 0 ? 'Already up to date.' : parts.join(' · ')
}
