import Dexie, { type EntityTable } from 'dexie'
import type { ProviderId } from './providers/types'

interface StoredKey {
  provider: ProviderId
  key: string
  savedAt: string
}

/**
 * Keys live in their own IndexedDB database, separate from `agentix`.
 *
 * The sync layer in Phase 6 walks the application database. A key that is not in
 * that database cannot be pushed to a server by an accident, a refactor, or a
 * future contributor who adds a table to the sync list. The separation is the
 * enforcement — "remember not to sync it" is not.
 */
class SecureDB extends Dexie {
  keys!: EntityTable<StoredKey, 'provider'>

  constructor() {
    super('agentix-secure')
    this.version(1).stores({ keys: 'provider' })
  }
}

const secureDb = new SecureDB()

export async function getKey(provider: ProviderId): Promise<string | null> {
  const row = await secureDb.keys.get(provider)
  return row?.key ?? null
}

export async function setKey(provider: ProviderId, key: string): Promise<void> {
  await secureDb.keys.put({ provider, key, savedAt: new Date().toISOString() })
}

export async function deleteKey(provider: ProviderId): Promise<void> {
  await secureDb.keys.delete(provider)
}

/** Which providers have a key, for UI state. Never returns the keys themselves. */
export async function listConfiguredProviders(): Promise<ProviderId[]> {
  const rows = await secureDb.keys.toArray()
  return rows.filter((r) => r.key.length > 0).map((r) => r.provider)
}
