// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { queries } from '../db/queries'
import type { SyncTable, Syncable } from '../db/types'
import { EPOCH, localStorageCursor, runSync, SyncError, type SyncTransport } from './engine'

/** A server in memory. Upserts by id, exactly as the real transport must. */
function fakeServer() {
  const rows = new Map<SyncTable, Map<string, Syncable>>()
  const pushes: Array<{ table: SyncTable; ids: string[] }> = []

  const transport: SyncTransport = {
    async pull(table, since) {
      const stored = [...(rows.get(table)?.values() ?? [])]
      return stored.filter((row) => row.updatedAt >= since)
    },
    async push(table, batch) {
      pushes.push({ table, ids: batch.map((r) => r.id) })
      const store = rows.get(table) ?? new Map()
      for (const row of batch) store.set(row.id, row)
      rows.set(table, store)
    },
  }

  return {
    transport,
    pushes,
    seed(table: SyncTable, row: Syncable) {
      const store = rows.get(table) ?? new Map()
      store.set(row.id, row)
      rows.set(table, store)
    },
    stored(table: SyncTable, id: string) {
      return rows.get(table)?.get(id)
    },
    count(table: SyncTable) {
      return rows.get(table)?.size ?? 0
    },
  }
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
    db.syncOutbox.clear(),
  ])
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the outbox', () => {
  it('queues a row on create and on every edit, exactly once', async () => {
    const task = await queries.createTask({ title: 'Queued', plannedFor: today() })
    await queries.updateTask(task.id, { title: 'Edited' })
    await queries.updateTask(task.id, { title: 'Edited again' })

    const outbox = await queries.listOutbox()
    expect(outbox).toHaveLength(1)
    expect(outbox[0]?.table).toBe('tasks')
    expect(outbox[0]?.rowId).toBe(task.id)
  })

  it('queues a soft delete like any other edit', async () => {
    const task = await queries.createTask({ title: 'Gone', plannedFor: today() })
    await queries.clearOutbox((await queries.listOutbox()).map((e) => e.id))

    await queries.deleteTask(task.id)
    expect(await queries.listOutbox()).toHaveLength(1)
  })

  it('queues writes made through every other path too', async () => {
    // Tag rewrites, person deletes and habit ticks all mutate rows, and a missed
    // call site here would mean silently unsynced data. Ticking a routine also
    // ticks the card it put on today's board, so `tasks` is queued twice: the
    // renamed one, and the routine's own.
    await queries.createTask({ title: 'Tagged', plannedFor: today(), tags: ['design'] })
    const habit = await queries.createHabit('Read', [], null, 'ocean')
    await queries.clearOutbox((await queries.listOutbox()).map((e) => e.id))

    await queries.renameTag('design', 'ux')
    await queries.setHabitDone(habit.id, today(), true)

    const tables = (await queries.listOutbox()).map((e) => e.table).sort()
    expect(tables).toEqual(['habitLogs', 'tasks', 'tasks'])
  })
})

describe('pushing', () => {
  it('sends queued rows and clears only what the server took', async () => {
    const server = fakeServer()
    const task = await queries.createTask({ title: 'Send me', plannedFor: today() })

    const result = await runSync(queries, server.transport, cursor())

    expect(result.ok).toBe(true)
    expect(server.stored('tasks', task.id)).toBeDefined()
    expect(await queries.listOutbox()).toEqual([])
  })

  it('leaves everything queued when the push fails', async () => {
    const server = fakeServer()
    vi.spyOn(server.transport, 'push').mockRejectedValue(new SyncError('Offline.'))
    await queries.createTask({ title: 'Stays queued', plannedFor: today() })

    const result = await runSync(queries, server.transport, cursor())

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Offline.')
    // Nothing lost: the same row goes out on the next attempt.
    expect(await queries.listOutbox()).toHaveLength(1)
  })

  it('holds a running timer back and sends it once it is stopped', async () => {
    const server = fakeServer()
    const task = await queries.createTask({ title: 'Timed', plannedFor: today() })
    const session = await queries.startSession(task.id)

    const first = await runSync(queries, server.transport, cursor())
    expect(server.stored('sessions', session.id)).toBeUndefined()
    expect(first.counts.held).toBe(1)
    // The entry stays queued rather than being dropped.
    expect((await queries.listOutbox()).some((e) => e.table === 'sessions')).toBe(true)

    await queries.stopRunningSession()
    await runSync(queries, server.transport, cursor())
    expect(server.stored('sessions', session.id)).toBeDefined()
  })

  it('drops a queue entry whose row no longer exists', async () => {
    const server = fakeServer()
    await queries.createTask({ title: 'Vanishes', plannedFor: today() })
    const [entry] = await queries.listOutbox()
    // A hard delete is not something the app does, but the queue must not spin
    // forever if a row goes missing.
    await db.tasks.delete(entry!.rowId)

    const result = await runSync(queries, server.transport, cursor())

    expect(result.ok).toBe(true)
    expect(await queries.listOutbox()).toEqual([])
  })

  it('pushes before it pulls', async () => {
    const server = fakeServer()
    const order: string[] = []
    vi.spyOn(server.transport, 'push').mockImplementation(async () => {
      order.push('push')
    })
    vi.spyOn(server.transport, 'pull').mockImplementation(async () => {
      order.push('pull')
      return []
    })
    await queries.createTask({ title: 'Order', plannedFor: today() })

    await runSync(queries, server.transport, cursor())
    expect(order[0]).toBe('push')
  })
})

describe('pulling', () => {
  it('applies a row this device has never seen', async () => {
    const server = fakeServer()
    server.seed('notes', {
      id: 'remote-note',
      updatedAt: '2026-08-27T10:00:00.000Z',
      deletedAt: null,
      taskId: null,
      content: 'From another device',
      aiSummary: null,
      createdAt: '2026-08-27T10:00:00.000Z',
    } as never)

    const result = await runSync(queries, server.transport, cursor())

    expect(result.counts.pulled).toBe(1)
    const notes = await queries.listNotes()
    expect(notes[0]?.content).toBe('From another device')
  })

  it('does not push a pulled row straight back', async () => {
    const server = fakeServer()
    server.seed('notes', {
      id: 'remote-note',
      updatedAt: '2026-08-27T10:00:00.000Z',
      deletedAt: null,
      taskId: null,
      content: 'Arrived',
      aiSummary: null,
      createdAt: '2026-08-27T10:00:00.000Z',
    } as never)

    await runSync(queries, server.transport, cursor())
    // Two devices bouncing the same row forever is exactly what this prevents.
    expect(await queries.listOutbox()).toEqual([])
  })

  it('keeps a newer local edit rather than letting an older server copy win', async () => {
    const server = fakeServer()
    const task = await queries.createTask({ title: 'Mine is newer', plannedFor: today() })
    // Nothing queued, so no push runs first and the pull meets a newer local row —
    // which is what a device coming back online after someone else pushed sees.
    await queries.clearOutbox((await queries.listOutbox()).map((e) => e.id))

    server.seed('tasks', {
      ...task,
      title: 'Stale server copy',
      updatedAt: '2020-01-01T00:00:00.000Z',
    } as never)

    const result = await runSync(queries, server.transport, cursor())

    expect(result.counts.conflicts).toBe(1)
    expect((await queries.getTask(task.id))?.title).toBe('Mine is newer')
  })

  it('applies a newer server edit over an older local one', async () => {
    const server = fakeServer()
    const task = await queries.createTask({ title: 'Old local', plannedFor: today() })
    await queries.clearOutbox((await queries.listOutbox()).map((e) => e.id))

    server.seed('tasks', {
      ...task,
      title: 'Newer elsewhere',
      updatedAt: '2099-01-01T00:00:00.000Z',
    } as never)

    await runSync(queries, server.transport, cursor())
    expect((await queries.getTask(task.id))?.title).toBe('Newer elsewhere')
  })

  it('propagates a delete made on another device', async () => {
    const server = fakeServer()
    const task = await queries.createTask({ title: 'Deleted elsewhere', plannedFor: today() })
    await queries.clearOutbox((await queries.listOutbox()).map((e) => e.id))

    server.seed('tasks', {
      ...task,
      updatedAt: '2099-01-01T00:00:00.000Z',
      deletedAt: '2099-01-01T00:00:00.000Z',
    } as never)

    await runSync(queries, server.transport, cursor())
    expect(await queries.getTask(task.id)).toBeUndefined()
  })

  it('advances the cursor so the next pull asks for less', async () => {
    const server = fakeServer()
    const marks = cursor()
    server.seed('notes', {
      id: 'n1',
      updatedAt: '2026-08-27T10:00:00.000Z',
      deletedAt: null,
      taskId: null,
      content: 'One',
      aiSummary: null,
      createdAt: '2026-08-27T10:00:00.000Z',
    } as never)

    await runSync(queries, server.transport, marks)
    expect(marks.get('notes')).not.toBe(EPOCH)

    const second = await runSync(queries, server.transport, marks)
    // The same row is not counted again.
    expect(second.counts.pulled).toBe(0)
  })
})

describe('two devices', () => {
  /**
   * The Phase 6 gate: edit on two devices offline, both reconnect, no data lost.
   */
  it('reconciles offline edits from both sides without losing either', async () => {
    const server = fakeServer()
    const marks = cursor()

    // Device A works offline and creates a task.
    const mine = await queries.createTask({ title: 'Written here', plannedFor: today() })

    // Device B, meanwhile, created its own and already reached the server.
    server.seed('tasks', {
      id: 'from-device-b',
      title: 'Written there',
      notes: null,
      link: null,
      status: 'todo',
      bucketId: 'bucket-todo',
      assigneeIds: [],
      plannedFor: today(),
      estimateMin: null,
      completedAt: null,
      priority: 0,
      tags: [],
      createdAt: '2026-08-27T10:00:00.000Z',
      updatedAt: '2026-08-27T10:00:00.000Z',
      deletedAt: null,
    } as never)

    const result = await runSync(queries, server.transport, marks)

    expect(result.ok).toBe(true)
    // Both survive: mine reached the server, theirs reached me.
    expect(server.stored('tasks', mine.id)).toBeDefined()
    expect(await queries.getTask('from-device-b')).toBeDefined()

    const titles = (await queries.listTasksByDay(today())).map((t) => t.title).sort()
    expect(titles).toEqual(['Written here', 'Written there'])
  })

  it('is idempotent: syncing twice changes nothing the second time', async () => {
    const server = fakeServer()
    const marks = cursor()
    await queries.createTask({ title: 'Once', plannedFor: today() })

    await runSync(queries, server.transport, marks)
    const second = await runSync(queries, server.transport, marks)

    expect(second.counts).toEqual({ pushed: 0, pulled: 0, held: 0, conflicts: 0 })
    expect(second.message).toBe('Already up to date.')
    expect(server.count('tasks')).toBe(1)
  })
})

describe('localStorageCursor', () => {
  it('starts at the epoch and remembers what it was told', async () => {
    const marks = localStorageCursor('test-cursor')
    expect(marks.get('tasks')).toBe(EPOCH)

    await marks.set('tasks', '2026-08-27T10:00:00.000Z')
    expect(localStorageCursor('test-cursor').get('tasks')).toBe('2026-08-27T10:00:00.000Z')
  })

  it('survives corrupted storage rather than throwing', () => {
    localStorage.setItem('broken-cursor', 'not json')
    expect(localStorageCursor('broken-cursor').get('tasks')).toBe(EPOCH)
  })
})
