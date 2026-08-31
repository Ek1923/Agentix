import type { SyncTable, Syncable } from '../db/types'
import { SyncError, type SyncTransport } from './engine'
import { activeProject, saveProject, toConfig } from './projects'

/**
 * The Supabase transport, spoken over PostgREST.
 *
 * Written against the HTTP API rather than the `@supabase/supabase-js` client on
 * purpose: sync needs exactly two verbs, and a dependency that ships an auth
 * stack, a realtime socket and a storage client to provide them is a large amount
 * of bundle for two fetches. Auth uses the same approach — see core/auth.
 */

export interface SupabaseConfig {
  url: string
  anonKey: string
}

function normalise(url: string, anonKey: string): SupabaseConfig | null {
  if (url.trim() === '' || anonKey.trim() === '') return null
  return { url: url.trim().replace(/\/$/, ''), anonKey: anonKey.trim() }
}

/**
 * What this device is pointed at, if anything.
 *
 * Delegates to `projects.ts`, which holds every project this device has been
 * connected to and which of them is live. This used to read one stored config;
 * keeping the function means every caller — auth, the transport, the settings
 * screen — kept working when one became many.
 */
export function readStoredConfig(): SupabaseConfig | null {
  const active = activeProject()
  return active === null ? null : toConfig(active)
}

/**
 * Points the device at a project, adding it to the list if it is new.
 *
 * Passing null is the disconnect: it clears the active selection without
 * forgetting the project, so reconnecting is a click rather than another trip to
 * the dashboard for a forty-character key. Forgetting one outright is
 * `forgetProject`.
 */
export function saveStoredConfig(config: SupabaseConfig | null): void {
  if (config === null) {
    try {
      localStorage.removeItem('agentix-project-active')
    } catch {
      // Blocked storage: the selection does not survive a reload. Degrade, do not fail.
    }
    return
  }
  const clean = normalise(config.url, config.anonKey)
  if (clean === null) return
  saveProject(clean.url, clean.anonKey)
}

/** True when the build itself was configured, rather than this device. */
export function isConfiguredByBuild(): boolean {
  const url = import.meta.env['VITE_SUPABASE_URL']
  const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY']
  return typeof url === 'string' && typeof anonKey === 'string' && normalise(url, anonKey) !== null
}

/**
 * Where sync points, if anywhere.
 *
 * Two sources, device first. The build environment is the sensible default for a
 * deployment everyone shares; the device override is what lets someone connect
 * their own project without a rebuild — exactly how the AI keys already work.
 *
 * Both values are publishable by design: the anon key is meant to ship in the
 * bundle, and row-level security is what actually protects the data. That is why
 * they can live in localStorage while an AI key never could.
 */
export function readSupabaseConfig(): SupabaseConfig | null {
  const stored = readStoredConfig()
  if (stored !== null) return stored

  const url = import.meta.env['VITE_SUPABASE_URL']
  const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY']
  if (typeof url !== 'string' || typeof anonKey !== 'string') return null

  return normalise(url, anonKey)
}

/** A URL that looks like a Supabase project, caught before a round trip. */
export function isValidProjectUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && url.hostname.includes('.')
  } catch {
    return false
  }
}

export function isSyncConfigured(): boolean {
  return readSupabaseConfig() !== null
}

/** Postgres columns are snake_case; the app is camelCase. One map, both ways. */
const REMOTE_TABLES: Record<SyncTable, string> = {
  tasks: 'tasks',
  sessions: 'time_sessions',
  notes: 'notes',
  buckets: 'buckets',
  people: 'people',
  habits: 'habits',
  habitLogs: 'habit_logs',
  // The identity side. These three are read by someone other than their author,
  // which is why they are not in a person's own project at all — they live on the
  // organisation's server, under membership-based policies rather than the "own
  // rows" one the data tables share. Named here because the resource names are
  // the same over PostgREST wherever it runs. See backends.ts and README.md.
  organizations: 'organizations',
  memberships: 'memberships',
}

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function toCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function encodeRow(row: Syncable, userId: string): Record<string, unknown> {
  const out: Record<string, unknown> = { user_id: userId }
  for (const [key, value] of Object.entries(row)) out[toSnake(key)] = value
  return out
}

function decodeRow(row: Record<string, unknown>): Syncable {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    // The server's own columns are not part of the app's model.
    if (key === 'user_id') continue
    out[toCamel(key)] = value
  }
  return out as unknown as Syncable
}

interface TransportOptions {
  config: SupabaseConfig
  /** The signed-in user's access token. Sync is never anonymous. */
  accessToken: string
  userId: string
}

export function createSupabaseTransport({
  config,
  accessToken,
  userId,
}: TransportOptions): SyncTransport {
  const headers = {
    apikey: config.anonKey,
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  }

  async function request(path: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      // Merged, not overwritten: the push relies on adding a `prefer` header, and
      // replacing the set outright would silently drop it — turning a retried
      // push into a duplicate-key failure instead of an upsert.
      response = await fetch(`${config.url}/rest/v1/${path}`, {
        ...init,
        headers: { ...headers, ...((init.headers as Record<string, string>) ?? {}) },
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
      const remote = REMOTE_TABLES[table]
      const query = `${remote}?select=*&updated_at=gte.${encodeURIComponent(since)}&order=updated_at.asc&limit=1000`
      const response = await request(query, { method: 'GET' })

      const rows = (await response.json()) as Array<Record<string, unknown>>
      return rows.map(decodeRow)
    },

    async push(table, rows) {
      if (rows.length === 0) return

      // merge-duplicates is what makes a retried push harmless: it upserts on the
      // primary key rather than failing on a row the server already has.
      await request(REMOTE_TABLES[table], {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.map((row) => encodeRow(row, userId))),
      })
    },
  }
}
