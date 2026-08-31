import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onLocalChange } from './changes'
import { db } from './db'
import { queries } from './queries'

beforeEach(async () => {
  await db.open()
  await Promise.all([db.tasks.clear(), db.sessions.clear(), db.syncOutbox.clear()])
})

describe('local change notifications', () => {
  it('announces the table a mutation wrote to', async () => {
    const seen: string[] = []
    const stop = onLocalChange((table) => seen.push(table))

    const task = await queries.createTask({ title: 'Ship it' })
    await queries.startSession(task.id)
    stop()

    expect(seen).toContain('tasks')
    expect(seen).toContain('sessions')
  })

  it('announces a row pulled from a server too — it moves the same totals', async () => {
    const listener = vi.fn()
    const stop = onLocalChange(listener)

    const task = await queries.createTask({ title: 'Local' })
    listener.mockClear()
    await queries.applyRemote('tasks', { ...task, title: 'From the server' })
    stop()

    expect(listener).toHaveBeenCalledWith('tasks')
  })

  it('stops when unsubscribed', async () => {
    const listener = vi.fn()
    onLocalChange(listener)()

    await queries.createTask({ title: 'Unheard' })

    expect(listener).not.toHaveBeenCalled()
  })

  it('does not let a broken listener fail the write that was being polite', async () => {
    const stop = onLocalChange(() => {
      throw new Error('subscriber is broken')
    })

    await expect(queries.createTask({ title: 'Still saved' })).resolves.toBeDefined()
    stop()
  })
})
