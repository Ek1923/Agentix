import type { Queries } from '../db/queries'
import { SYNC_TABLES, type SyncTable, type Syncable } from '../db/types'
import { type Backend, backendOf } from './backends'
import {
  addCounts,
  describeCounts,
  emptyCounts,
  mergePull,
  nextCursor,
  splitPushable,
  type SyncCounts,
} from './merge'

/**
 * What the sync engine needs from a server.
 *
 * An interface rather than a Supabase import, for the same reason `ai.complete()`
 * hides a provider: the engine is the part worth testing, and it must be testable
 * without a network. Swapping Supabase for anything else is one new file.
 */
export interface SyncTransport {
  /** Rows changed at or after `since`, for one table. */
  pull(table: SyncTable, since: string): Promise<Syncable[]>
  /** Upserts rows by id. Must be idempotent — a retried push is normal. */
  push(table: SyncTable, rows: Syncable[]): Promise<void>
}

export interface SyncCursor {
  get(table: SyncTable): string
  set(table: SyncTable, cursor: string): Promise<void>
}

export interface SyncResult {
  ok: boolean
  counts: SyncCounts
  message: string
}

/** The beginning of time, for a device that has never pulled. */
export const EPOCH = '1970-01-01T00:00:00.000Z'

/**
 * Which transport a given table syncs through.
 *
 * The engine never knows there are two backends — it asks this for every table
 * and gets back whatever should carry it. A single-backend caller returns the
 * same transport for all of them; a split caller routes by `backendOf`. That is
 * the whole seam, and it keeps the push/pull loops identical in both cases.
 */
export type TransportFor = (table: SyncTable) => SyncTransport

/**
 * One sync pass: push what is queued, then pull what changed.
 *
 * Push first on purpose. Pulling first would apply a server row over a local edit
 * that has not been sent yet, and the local edit would then be pushed on top —
 * two round trips to reach the same place, with a visible flicker in between.
 *
 * The outbox is cleared only for rows the server accepted. A push that throws
 * leaves everything queued, so the next attempt sends it again; the transport
 * upserts by id, so a duplicate send is harmless.
 *
 * `transport` may be one transport for everything — the single-backend case every
 * existing caller uses — or a resolver that hands back a different transport per
 * table. `runSyncSplit` is the two-backend entry point built on the latter.
 */
export async function runSync(
  db: Queries,
  transport: SyncTransport | TransportFor,
  cursor: SyncCursor,
): Promise<SyncResult> {
  const resolve: TransportFor = typeof transport === 'function' ? transport : () => transport

  let counts = emptyCounts()

  try {
    counts = addCounts(counts, await pushAll(db, resolve))
    counts = addCounts(counts, await pullAll(db, resolve, cursor))
    return { ok: true, counts, message: describeCounts(counts) }
  } catch (error) {
    // Transport errors are written to be safe to display; anything else is
    // replaced, because an unknown error may quote the request.
    const message =
      error instanceof Error && error.name === 'SyncError'
        ? error.message
        : 'Sync failed. Nothing was lost — it will try again.'
    return { ok: false, counts, message }
  }
}

/**
 * One sync pass across both backends.
 *
 * Each table is routed to the backend that owns it — identity tables to the org's
 * server, content tables to the person's own Supabase — so a single call keeps
 * both in step. A failure on either backend surfaces as one failed pass with the
 * counts that did land; the outbox holds whatever was not accepted, on whichever
 * backend refused it, and the next pass retries only that.
 */
export function runSyncSplit(
  db: Queries,
  transports: Record<Backend, SyncTransport>,
  cursor: SyncCursor,
): Promise<SyncResult> {
  return runSync(db, (table) => transports[backendOf(table)], cursor)
}

async function pushAll(db: Queries, resolve: TransportFor): Promise<Partial<SyncCounts>> {
  const outbox = await db.listOutbox()
  if (outbox.length === 0) return {}

  let pushed = 0
  let held = 0

  for (const table of SYNC_TABLES) {
    const entries = outbox.filter((entry) => entry.table === table)
    if (entries.length === 0) continue

    const queued: Array<{ entryId: string; row: Syncable }> = []
    for (const entry of entries) {
      const row = (await db.readRow(table, entry.rowId)) as Syncable | undefined
      // A row that no longer exists cannot be sent; drop its entry rather than
      // retrying it forever.
      if (row === undefined) {
        await db.clearOutbox([entry.id])
        continue
      }
      queued.push({ entryId: entry.id, row })
    }

    const { batch, held: heldEntries } = splitPushable(table, queued)
    held += heldEntries.length

    if (batch.rows.length === 0) continue

    await resolve(table).push(table, batch.rows)
    // Cleared only after the server accepted them.
    await db.clearOutbox(batch.entryIds)
    pushed += batch.rows.length
  }

  return { pushed, held }
}

async function pullAll(
  db: Queries,
  resolve: TransportFor,
  cursor: SyncCursor,
): Promise<Partial<SyncCounts>> {
  let pulled = 0
  let conflicts = 0

  for (const table of SYNC_TABLES) {
    const since = cursor.get(table)
    const remote = await resolve(table).pull(table, since)
    if (remote.length === 0) continue

    const locals: Syncable[] = []
    for (const row of remote) {
      const local = (await db.readRow(table, row.id)) as Syncable | undefined
      if (local !== undefined) locals.push(local)
    }

    const decision = mergePull(locals, remote)
    for (const row of decision.apply) {
      // applyRemote writes without queueing: a pulled row must not be pushed
      // straight back, or two devices bounce it between them forever.
      await db.applyRemote(table, row)
    }

    pulled += decision.apply.length
    conflicts += decision.keptLocal.length
    await cursor.set(table, nextCursor(since, remote))
  }

  return { pulled, conflicts }
}

/** Thrown by a transport. Its message is written to be safe to show a person. */
export class SyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncError'
  }
}

/**
 * Cursors in localStorage.
 *
 * Not in the synced database on purpose: a cursor describes what *this device*
 * has seen, so syncing it to another device would make that device skip rows it
 * never received.
 */
export function localStorageCursor(namespace = 'agentix-sync'): SyncCursor {
  const read = (): Record<string, string> => {
    try {
      const raw = localStorage.getItem(namespace)
      return raw === null ? {} : (JSON.parse(raw) as Record<string, string>)
    } catch {
      return {}
    }
  }

  return {
    get: (table) => read()[table] ?? EPOCH,
    set: async (table, value) => {
      try {
        localStorage.setItem(namespace, JSON.stringify({ ...read(), [table]: value }))
      } catch {
        // A full or blocked storage must not fail a sync that already succeeded;
        // the cost is re-pulling the same rows next time, which merges to a no-op.
      }
    },
  }
}
