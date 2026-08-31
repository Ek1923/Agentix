// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { queries } from '../db/queries'
import type { SyncTable, Syncable } from '../db/types'
import { backendOf, tablesForBackend } from './backends'
import { EPOCH, runSyncSplit, type SyncTransport } from './engine'

/**
 * A transport that only records which tables it was asked for.
 *
 * The split is about routing, not merging, so these assertions are about which
 * backend a table reached — never about what came back.
 */
function recordingTransport() {
  const pulled: SyncTable[] = []
  const pushed: SyncTable[] = []
  const transport: SyncTransport = {
    pull: vi.fn(async (table: SyncTable) => {
      pulled.push(table)
      return [] as Syncable[]
    }),
    push: vi.fn(async (table: SyncTable) => {
      pushed.push(table)
    }),
  }
  return { transport, pulled, pushed }
}

function cursor() {
  const state = new Map<SyncTable, string>()
  return {
    get: (table: SyncTable) => state.get(table) ?? EPOCH,
    set: async (table: SyncTable, value: string) => {
      state.set(table, value)
    },
  }
}

const today = () => queries.todayLocal()

beforeEach(async () => {
  await db.open()
  await Promise.all([
    db.tasks.clear(),
    db.sessions.clear(),
    db.notes.clear(),
    db.buckets.clear(),
    db.people.clear(),
    db.habits.clear(),
    db.habitLogs.clear(),
    db.organizations.clear(),
    db.memberships.clear(),
    db.syncOutbox.clear(),
  ])
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('routing a pass across two backends', () => {
  it('pulls each table only from the backend that owns it', async () => {
    const identity = recordingTransport()
    const data = recordingTransport()

    await runSyncSplit(queries, { identity: identity.transport, data: data.transport }, cursor())

    // Every table asked for on the identity side belongs there, and likewise for
    // data — nothing crosses.
    expect(identity.pulled.sort()).toEqual([...tablesForBackend('identity')].sort())
    expect(data.pulled.sort()).toEqual([...tablesForBackend('data')].sort())
    for (const table of identity.pulled) expect(backendOf(table)).toBe('identity')
    for (const table of data.pulled) expect(backendOf(table)).toBe('data')
  })

  it('pushes a content row to the person’s project, never the org server', async () => {
    const identity = recordingTransport()
    const data = recordingTransport()

    // A task is authored content, so it must leave through the data backend only.
    await queries.createTask({ title: 'Content', plannedFor: today() })
    await runSyncSplit(queries, { identity: identity.transport, data: data.transport }, cursor())

    expect(data.pushed).toContain('tasks')
    expect(identity.pushed).not.toContain('tasks')
  })

  it('lets one backend fail without discarding the other’s queued work', async () => {
    const identity = recordingTransport()
    const data = recordingTransport()
    // The person's own project is unreachable; the org server is fine.
    ;(data.transport.push as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'))

    await queries.createTask({ title: 'Held', plannedFor: today() })
    const result = await runSyncSplit(
      queries,
      { identity: identity.transport, data: data.transport },
      cursor(),
    )

    // The pass reports failure, and the task is still queued for the next attempt
    // rather than silently dropped.
    expect(result.ok).toBe(false)
    const stillQueued = (await queries.listOutbox()).some((e) => e.table === 'tasks')
    expect(stillQueued).toBe(true)
  })
})
