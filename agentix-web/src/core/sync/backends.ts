import type { SyncTable } from '../db/types'

/**
 * Which of the two backends a table lives on.
 *
 * Agentix syncs against two places at once, and the split is a deliberate
 * liability boundary rather than a technical convenience:
 *
 * - **identity** — the org's own server (self-hosted, one for the organisation).
 *   It holds the light coordination layer: who people are, which organisations
 *   and memberships exist, and the shared pool of people a task can be assigned
 *   to. Low-sensitivity metadata — names, addresses, labels — never the content
 *   someone actually writes.
 *
 * - **data** — each person's *own* Supabase project. It holds everything a person
 *   authors: tasks, notes, time, the board, habits. The heavy, potentially
 *   sensitive content stays with them. If it ever leaks, it leaks from their
 *   project under their control, not from the org's server.
 *
 * That boundary is the whole reason the split exists, so it is expressed as data
 * here — one map, read the same way by the sync engine, the health lights and the
 * eventual Swift port — rather than scattered across the call sites that happen to
 * touch each table.
 */
export type Backend = 'identity' | 'data'

/**
 * The routing table. Every `SyncTable` must appear exactly once; the exhaustive
 * `Record` type makes a newly added table a compile error until it is placed.
 *
 * `tags` is not here yet because tags are still an inline `string[]` on a task,
 * not a synced table. When the shared tag system lands it joins the identity side
 * — a label is coordination metadata, like the pool — and this map is where that
 * decision gets recorded.
 */
export const BACKEND_OF: Record<SyncTable, Backend> = {
  // The org's server: identity and shared coordination.
  organizations: 'identity',
  memberships: 'identity',
  people: 'identity',

  // The person's own Supabase: everything they author.
  tasks: 'data',
  notes: 'data',
  sessions: 'data',
  buckets: 'data',
  habits: 'data',
  habitLogs: 'data',
}

/** Where a single table syncs. */
export function backendOf(table: SyncTable): Backend {
  return BACKEND_OF[table]
}

/**
 * The tables that live on one backend.
 *
 * Derived from the map rather than hand-listed, so the two never drift: moving a
 * table between backends is a one-line edit above and both this and `backendOf`
 * follow.
 */
export function tablesForBackend(backend: Backend): SyncTable[] {
  return (Object.keys(BACKEND_OF) as SyncTable[]).filter((table) => BACKEND_OF[table] === backend)
}

/** True when the table holds content a person authored, not coordination metadata. */
export function isContentTable(table: SyncTable): boolean {
  return BACKEND_OF[table] === 'data'
}
