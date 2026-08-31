import type { SyncTable } from './types'

/**
 * A whisper that storage changed, so a screen holding a derived total can go and
 * recompute it.
 *
 * Dexie's live queries already cover "show me these rows" — this is for the other
 * shape: a lifetime aggregate like the rank, which is not a query over a table but
 * a fold over all of it. Subscribing that to a live query would re-run a full scan
 * on every keystroke in an unrelated field; subscribing it here re-runs it only
 * when something was actually written.
 *
 * Fed from `touch()` and `applyRemote()` in `queries.ts`, which between them see
 * every write — local edits and rows pulled from a server alike. Listeners are
 * told *which table*, never the row: this is a hint to re-read, not a data feed.
 * Anything that needs the row itself should be reading the table.
 *
 * Synchronous, deliberately: it fires inside the write that caused it, so a
 * listener that debounces (as the rank does) coalesces a transaction's several
 * touches into one recomputation.
 */
export type ChangeListener = (table: SyncTable) => void

const listeners = new Set<ChangeListener>()

/** Subscribes; returns the unsubscribe. */
export function onLocalChange(listener: ChangeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Announces a write. Called by the storage layer only.
 *
 * A listener that throws is swallowed: a broken subscriber must not fail the
 * transaction that was only being polite enough to mention it.
 */
export function notifyChanged(table: SyncTable): void {
  for (const listener of [...listeners]) {
    try {
      listener(table)
    } catch {
      // Not this write's problem.
    }
  }
}
