import { BACKEND_OF } from './backends'
import type { SyncTable } from '../db/types'
import { SyncError, type SyncTransport } from './engine'
import { createPostgrestTransport } from './postgrest'

/**
 * The transport for the organisation's own server.
 *
 * This is the other half of the split described in `backends.ts`: the roster, the
 * organisations and the shared pool of people live on a box the organisation runs
 * itself, and everything a person authors lives in their own Supabase. Two
 * transports, one engine, one pass — see `runSyncSplit`.
 *
 * It speaks the same protocol as the Supabase side, because the box runs the same
 * PostgREST. Three things differ, and they are the whole file:
 *
 * - **There is no project key.** Supabase wants an `apikey` header naming the
 *   project; a server that hosts exactly one thing does not.
 * - **The token comes from Keycloak**, signed with a key that never leaves the
 *   server. Each member's Supabase verifies it with the public half, so nothing
 *   shared ever has to be copied between them — see `core/auth/keycloak.ts`.
 * - **The rows are shared.** `user_id` still travels, but it records who last
 *   wrote a row rather than who may read it; being on the roster is what the
 *   policies actually check.
 */

export interface IdentityConfig {
  /** The origin the tunnel serves, without a trailing slash. */
  url: string
}

const URL_KEY = 'agentix-identity-url'

function normalise(url: string): IdentityConfig | null {
  const clean = url.trim().replace(/\/$/, '')
  if (clean === '') return null
  try {
    const parsed = new URL(clean)
    // Tokens and a roster travel over this; plain http would put both on the wire.
    // Localhost is the exception, because that is where the box is tested from.
    const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
    if (parsed.protocol !== 'https:' && !local) return null
    return { url: clean }
  } catch {
    return null
  }
}

/**
 * Where the organisation's server is, if this device knows.
 *
 * Two sources, device first, exactly like the Supabase config: the build variable
 * is the sensible default for everyone in one organisation, and the device
 * override is what lets the owner point a browser at a box that is still being
 * stood up without rebuilding the app.
 *
 * The URL is not a secret. It is a public hostname that answers to anyone who
 * asks; what protects the data behind it is the token and the row-level policies.
 */
export function readIdentityConfig(): IdentityConfig | null {
  try {
    const stored = localStorage.getItem(URL_KEY)
    if (stored !== null) {
      const device = normalise(stored)
      if (device !== null) return device
    }
  } catch {
    // Blocked storage. Fall through to the build variable.
  }

  const url = import.meta.env['VITE_IDENTITY_URL']
  return typeof url === 'string' ? normalise(url) : null
}

/** Points this device at a server, or forgets the one it had. */
export function saveIdentityUrl(url: string | null): void {
  try {
    if (url === null) {
      localStorage.removeItem(URL_KEY)
      return
    }
    const clean = normalise(url)
    if (clean !== null) localStorage.setItem(URL_KEY, clean.url)
  } catch {
    // As above: the app still works, this device just will not remember.
  }
}

export function isIdentityConfigured(): boolean {
  return readIdentityConfig() !== null
}

/** Keycloak's realm base. The realm name is fixed; the server is not. */
export function realmUrl(config: IdentityConfig): string {
  return `${config.url}/realms/agentix`
}

/**
 * What each identity table is called on the server.
 *
 * The names match `server/schema/schema.sql`. A table that belongs to the other
 * backend must never arrive here — `backends.ts` routes it away — so being asked
 * for one is a routing bug, and it fails loudly rather than quietly writing an
 * organisation's server full of somebody's tasks.
 */
function resource(table: SyncTable): string {
  if (BACKEND_OF[table] !== 'identity') {
    throw new SyncError('That table does not belong to the organisation server.')
  }
  return table
}

interface IdentityTransportOptions {
  config: IdentityConfig
  /** The Keycloak access token. The server trusts nothing else. */
  accessToken: string
  /** The `sub` claim — a uuid, which is what the schema's `user_id` expects. */
  userId: string
}

export function createIdentityTransport({
  config,
  accessToken,
  userId,
}: IdentityTransportOptions): SyncTransport {
  return createPostgrestTransport({
    baseUrl: `${config.url}/rest/v1`,
    headers: { authorization: `Bearer ${accessToken}` },
    resource,
    userId,
  })
}
