import { backendOf } from './backends'
import type { TransportFor } from './engine'
import { createIdentityTransport, type IdentityConfig } from './identity'
import { createSupabaseTransport, type SupabaseConfig } from './supabase'

/**
 * Picking the transports for one sync pass.
 *
 * The engine takes a function from table to transport and knows nothing else, so
 * this is the only place that has to understand what a device is currently
 * connected to. Kept out of the screen that syncs because the answer is a rule,
 * not a rendering concern — and because a rule with three cases deserves tests.
 *
 * **One token, two servers.** Under route A the person signs in once, at the
 * organisation's Keycloak, and the same access token is presented to their own
 * Supabase — which verifies it against the realm's public keys, configured there
 * as third-party auth. That is the whole reason for the asymmetric signing: no
 * shared secret is ever copied between the organisation's box and anybody's
 * project. Supabase still wants its `apikey` alongside, because that names the
 * project rather than the person.
 */

export interface BackendAccess {
  identity: { config: IdentityConfig } | null
  data: { config: SupabaseConfig } | null
  /** Whoever is signed in, and the token both servers are asked to trust. */
  session: { accessToken: string; userId: string } | null
}

export type SyncScope =
  /** Both halves: the roster from the org's server, the content from their own project. */
  | 'both'
  /** No organisation server on this device — the personal app, syncing its own content. */
  | 'data-only'
  /** Nothing to sync against. */
  | 'none'

export interface ResolvedTransports {
  scope: SyncScope
  /** Null exactly when the scope is `none`. */
  transportFor: TransportFor | null
}

/**
 * What this device can sync against right now.
 *
 * Three cases, and the missing fourth is deliberate: an organisation server
 * *without* a personal project is not treated as syncable. The roster alone would
 * be syncing, while every task, note and timer stayed queued in the outbox behind
 * a backend that is not there — a sync that reports success while the work it was
 * asked to protect goes nowhere. Setting up the project is one screen; pretending
 * is worse.
 */
export function resolveTransports(access: BackendAccess): ResolvedTransports {
  const { identity, data, session } = access
  if (session === null || data === null) return { scope: 'none', transportFor: null }

  const dataTransport = createSupabaseTransport({
    config: data.config,
    accessToken: session.accessToken,
    userId: session.userId,
  })

  if (identity === null) {
    return { scope: 'data-only', transportFor: () => dataTransport }
  }

  const identityTransport = createIdentityTransport({
    config: identity.config,
    accessToken: session.accessToken,
    userId: session.userId,
  })

  return {
    scope: 'both',
    transportFor: (table) =>
      backendOf(table) === 'identity' ? identityTransport : dataTransport,
  }
}
