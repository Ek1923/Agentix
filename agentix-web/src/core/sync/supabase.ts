import type { SyncTable } from '../db/types'
import type { SyncTransport } from './engine'
import { createPostgrestTransport } from './postgrest'
import { activeProject, saveProject, toConfig } from './projects'

/**
 * The Supabase transport, spoken over PostgREST.
 *
 * Written against the HTTP API rather than the `@supabase/supabase-js` client on
 * purpose: sync needs exactly two verbs, and a dependency that ships an auth
 * stack, a realtime socket and a storage client to provide them is a large amount
 * of bundle for two fetches. Auth uses the same approach — see core/auth.
 *
 * The requests themselves live in `postgrest.ts`, because the organisation's own
 * server speaks the same protocol. What is Supabase-specific is here: where the
 * project lives, the `apikey` header it wants alongside the token, and the fact
 * that this device may be pointed at one of several saved projects.
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
  return createPostgrestTransport({
    baseUrl: `${config.url}/rest/v1`,
    // The anon key identifies the project, the bearer token identifies the person.
    // Supabase wants both: without the first the request never reaches the row-level
    // policy that the second is checked against.
    headers: {
      apikey: config.anonKey,
      authorization: `Bearer ${accessToken}`,
    },
    resource: (table) => REMOTE_TABLES[table],
    userId,
  })
}
