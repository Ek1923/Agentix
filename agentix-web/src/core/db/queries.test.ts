import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { queries } from './queries'

beforeEach(async () => {
  await db.open()
  await Promise.all([db.tasks.clear(), db.sessions.clear(), db.notes.clear()])
})

describe('tasks', () => {
  it('stamps audit fields and defaults on create', async () => {
    const task = await queries.createTask({ title: 'Write the brief' })

    expect(task.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(task.status).toBe('todo')
    expect(task.priority).toBe(0)
    expect(task.tags).toEqual([])
    expect(task.deletedAt).toBeNull()
    expect(task.createdAt).toBe(task.updatedAt)
    expect(new Date(task.createdAt).toISOString()).toBe(task.createdAt)
  })

  it('defaults plannedFor to the local calendar date, not a UTC datetime', async () => {
    const task = await queries.createTask({ title: 'Today' })

    expect(task.plannedFor).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(task.plannedFor).toBe(queries.todayLocal())
  })

  it('moves updatedAt forward on every edit', async () => {
    const task = await queries.createTask({ title: 'Before' })
    await new Promise((r) => setTimeout(r, 5))
    await queries.updateTask(task.id, { title: 'After' })

    const updated = await queries.getTask(task.id)
    expect(updated?.title).toBe('After')
    expect(updated!.updatedAt > task.updatedAt).toBe(true)
    expect(updated!.createdAt).toBe(task.createdAt)
  })

  it('soft deletes: the row survives but reads no longer return it', async () => {
    const task = await queries.createTask({ title: 'Gone' })
    await queries.deleteTask(task.id)

    expect(await queries.getTask(task.id)).toBeUndefined()
    expect(await queries.listTasksByDay(task.plannedFor)).toEqual([])

    // Still on disk, so the delete can sync like any other edit.
    const raw = await db.tasks.get(task.id)
    expect(raw?.deletedAt).not.toBeNull()
  })

  it('lists a day without leaking other days', async () => {
    await queries.createTask({ title: 'Monday', plannedFor: '2026-03-02' })
    await queries.createTask({ title: 'Tuesday', plannedFor: '2026-03-03' })

    const monday = await queries.listTasksByDay('2026-03-02')
    expect(monday.map((t) => t.title)).toEqual(['Monday'])
  })

  it('lists an inclusive date range for backtest windows', async () => {
    await queries.createTask({ title: 'Before', plannedFor: '2026-03-01' })
    await queries.createTask({ title: 'Start', plannedFor: '2026-03-02' })
    await queries.createTask({ title: 'End', plannedFor: '2026-03-04' })
    await queries.createTask({ title: 'After', plannedFor: '2026-03-05' })

    const inRange = await queries.listTasksInRange('2026-03-02', '2026-03-04')
    expect(inRange.map((t) => t.title).sort()).toEqual(['End', 'Start'])
  })
})

describe('time sessions', () => {
  it('starting a timer closes the one already running', async () => {
    const a = await queries.createTask({ title: 'A' })
    const b = await queries.createTask({ title: 'B' })

    const first = await queries.startSession(a.id)
    const second = await queries.startSession(b.id)

    const closed = await db.sessions.get(first.id)
    expect(closed?.endedAt).not.toBeNull()

    const running = await queries.getRunningSession()
    expect(running?.id).toBe(second.id)
  })

  it('never leaves more than one session open, however many starts race', async () => {
    const task = await queries.createTask({ title: 'Contended' })

    await Promise.all([
      queries.startSession(task.id),
      queries.startSession(task.id),
      queries.startSession(task.id),
    ])

    const open = await db.sessions.filter((s) => s.endedAt === null).toArray()
    expect(open).toHaveLength(1)
  })

  it('keeps one task many sessions, so when the work happened is preserved', async () => {
    const task = await queries.createTask({ title: 'Split by lunch' })

    await queries.startSession(task.id)
    await queries.stopRunningSession()
    await queries.startSession(task.id)
    await queries.stopRunningSession()

    const sessions = await queries.listSessionsForTask(task.id)
    expect(sessions).toHaveLength(2)
    expect(sessions.every((s) => s.endedAt !== null)).toBe(true)
  })

  it('stopping with no timer running is a no-op, not an error', async () => {
    expect(await queries.stopRunningSession()).toBeUndefined()
  })

  it('ignores a soft-deleted session when looking for the running one', async () => {
    const task = await queries.createTask({ title: 'Deleted mid-run' })
    const session = await queries.startSession(task.id)
    await queries.deleteSession(session.id)

    expect(await queries.getRunningSession()).toBeUndefined()
  })
})

describe('notes', () => {
  it('supports standalone notes and task-linked notes', async () => {
    const task = await queries.createTask({ title: 'Has notes' })
    const standalone = await queries.createNote({ content: 'Loose thought' })
    await queries.createNote({ content: 'About the task', taskId: task.id })

    expect(standalone.taskId).toBeNull()
    expect(standalone.aiSummary).toBeNull()

    const linked = await queries.listNotesForTask(task.id)
    expect(linked.map((n) => n.content)).toEqual(['About the task'])
  })

  it('soft deletes notes too', async () => {
    const task = await queries.createTask({ title: 'T' })
    const note = await queries.createNote({ content: 'Bye', taskId: task.id })
    await queries.deleteNote(note.id)

    expect(await queries.listNotesForTask(task.id)).toEqual([])
    expect(await db.notes.get(note.id)).toBeDefined()
  })
})
