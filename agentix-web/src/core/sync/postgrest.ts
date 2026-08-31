import type { SyncTable, Syncable } from '../db/types'
import { SyncError, type SyncTransport } from './engine'

/**
 * Sync over PostgREST, which both backends happen to speak.
 *
 * Supabase exposes PostgREST, and the organisation's own server runs the same
 * thing behind its tunnel. The two differ in exactly three ways — where they live,
 * what proves who you are, and what the tables are called — so those are the
 * parameters and everything else is shared. Writing the second transport as a copy
 * of the first would have meant two places to fix the day a header or an upsert
 * preference turns out to be wrong.
 *
 * Deliberately written against the HTTP API rather than a client library: sync
 * needs two verbs, and a dependency that ships auth, realtime and storage to
 * provide them is a lot of bundle for two fetches.
 */

export interface PostgrestOptions {
  /** Where the API lives, including the version path and no trailing slash. */
  baseUrl: string
  /** Sent on every request. Whatever proves who is asking belongs here. */
  headers: Record<string, string>
  /** The app's table name, as the server exposes it. */
  resource: (table: SyncTable) => string
  /**
   * Stamped onto every pushed row.
   *
   * On a person's own project this is what the "own rows" policy reads. On the
   * organisation's server it records who last wrote a shared row and is
   * deliberately *not* what the policies read — being on the roster is.
   */
  userId: string
}

/** Postgres columns are snake_case; the app is camelCase. One map, both ways. */
export function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

export function toCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

export function encodeRow(row: Syncable, userId: string): Record<string, unknown> {
  const out: Record<string, unknown> = { user_id: userId }
  for (const [key, value] of Object.entries(row)) out[toSnake(key)] = value
  return out
}

export function decodeRow(row: Record<string, unknown>): Syncable {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    // The server's own columns are not part of the app's model.
    if (key === 'user_id') continue
    out[toCamel(key)] = value
  }
  return out as unknown as Syncable
}

export function createPostgrestTransport({
  baseUrl,
  headers,
  resource,
  userId,
}: PostgrestOptions): SyncTransport {
  const base = { 'content-type': 'application/json', ...headers }

  async function request(path: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      // Merged, not overwritten: the push relies on adding a `prefer` header, and
      // replacing the set outright would silently drop it — turning a retried
      // push into a duplicate-key failure instead of an upsert.
      response = await fetch(`${baseUrl}/${path}`, {
        ...init,
        headers: { ...base, ...((init.headers as Record<string, string>) ?? {}) },
      })
    } catch {
      // The caught error is dropped deliberately: a fetch failure can carry
      // request details, and request details carry the access token.
      throw new SyncError('Could not reach the server. Your work is saved here.')
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new SyncError('Sign-in expired. Sign in again to keep syncing.')
      }
      throw new SyncError(`The server refused the request (HTTP ${response.status}).`)
    }
    return response
  }

  return {
    async pull(table, since) {
      const query = `${resource(table)}?select=*&updated_at=gte.${encodeURIComponent(since)}&order=updated_at.asc&limit=1000`
      const response = await request(query, { method: 'GET' })

      const rows = (await response.json()) as Array<Record<string, unknown>>
      return rows.map(decodeRow)
    },

    async push(table, rows) {
      if (rows.length === 0) return

      // merge-duplicates is what makes a retried push harmless: it upserts on the
      // primary key rather than failing on a row the server already has.
      await request(resource(table), {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.map((row) => encodeRow(row, userId))),
      })
    },
  }
}
