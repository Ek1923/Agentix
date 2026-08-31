// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAIService } from '../../core/ai'
import { db } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import type { PluginContext } from '../../core/plugin-host/types'
import { activeAIConfig } from '../../core/settings/store'
import { tagsPlugin } from './index'

const ctx: PluginContext = {
  db: queries,
  ai: createAIService(activeAIConfig),
  navigate: () => {},
}

const Tags = tagsPlugin.Component
const today = () => queries.todayLocal()

async function trackMinutes(taskId: string, minutes: number) {
  const session = await queries.startSession(taskId)
  const end = Date.now() - 3_600_000
  await db.sessions.update(session.id, {
    startedAt: new Date(end - minutes * 60_000).toISOString(),
    endedAt: new Date(end).toISOString(),
  })
}

beforeEach(async () => {
  await db.open()
  await Promise.all([db.tasks.clear(), db.sessions.clear(), db.buckets.clear()])
  await queries.ensureDefaultBuckets()
})

afterEach(cleanup)

describe('Tags', () => {
  it('shows a real empty state when nothing is tagged', async () => {
    await queries.createTask({ title: 'Untagged', plannedFor: today() })

    render(<Tags ctx={ctx} />)
    expect(await screen.findByText('Nothing is tagged yet.')).toBeInTheDocument()
  })

  it('reports time and completion per tag', async () => {
    const task = await queries.createTask({
      title: 'Design work',
      plannedFor: today(),
      tags: ['design'],
    })
    await trackMinutes(task.id, 90)
    await queries.setTaskDone(task.id, true)

    render(<Tags ctx={ctx} />)

    /*
      Waited for, not read once. The tag name comes from the task query and the
      total from the session query, and they resolve independently — so the row
      can be on screen with its time still blank for a frame.
    */
    expect(await screen.findByText('1h 30m tracked')).toBeInTheDocument()
    expect(await screen.findByText(/1\/1 done · 100%/)).toBeInTheDocument()
  })

  it('counts how much work carries no tag at all', async () => {
    await queries.createTask({ title: 'Tagged', plannedFor: today(), tags: ['design'] })
    await queries.createTask({ title: 'Untagged', plannedFor: today() })

    render(<Tags ctx={ctx} />)
    expect(await screen.findByText(/1 task carry no tag/)).toBeInTheDocument()
  })

  it('renames a tag everywhere it appears', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'A', plannedFor: today(), tags: ['design'] })
    await queries.createTask({ title: 'B', plannedFor: today(), tags: ['design'] })

    render(<Tags ctx={ctx} />)
    await user.click(await screen.findByRole('button', { name: 'Rename design' }))

    const input = screen.getByLabelText('Tag name')
    await user.clear(input)
    await user.type(input, 'ux')
    await user.click(screen.getByRole('button', { name: /Save name for design/ }))

    await waitFor(async () => {
      const tasks = await queries.listTasksByDay(today())
      expect(tasks.every((t) => t.tags.includes('ux'))).toBe(true)
      expect(tasks.some((t) => t.tags.includes('design'))).toBe(false)
    })
  })

  it('never leaves a duplicate when renaming onto an existing tag', async () => {
    await queries.createTask({
      title: 'Both',
      plannedFor: today(),
      tags: ['design', 'ux'],
    })

    await queries.renameTag('design', 'ux')

    const [task] = await queries.listTasksByDay(today())
    expect(task?.tags).toEqual(['ux'])
  })

  it('removes a tag from every task without deleting the tasks', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Keeps living', plannedFor: today(), tags: ['admin'] })

    render(<Tags ctx={ctx} />)
    await user.click(
      await screen.findByRole('button', { name: /Remove admin from every task/ }),
    )

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.tags).toEqual([])
      expect(task?.deletedAt).toBeNull()
    })
  })

  it('sorts by time, tasks and name', async () => {
    const user = userEvent.setup()
    const heavy = await queries.createTask({ title: 'Heavy', plannedFor: today(), tags: ['zeta'] })
    await queries.createTask({ title: 'One', plannedFor: today(), tags: ['alpha'] })
    await queries.createTask({ title: 'Two', plannedFor: today(), tags: ['alpha'] })
    await trackMinutes(heavy.id, 120)

    render(<Tags ctx={ctx} />)
    // Sessions arrive from their own live query; until they do every tag reads as
    // zero tracked time and the order is not yet the one under test.
    await screen.findByText('2h tracked')

    const tagOrder = () =>
      screen.getAllByRole('listitem').map((item) => item.textContent?.trim().slice(0, 5))

    expect(tagOrder()[0]).toContain('zeta')

    await user.click(screen.getByRole('radio', { name: 'Tasks' }))
    await waitFor(() => expect(tagOrder()[0]).toContain('alpha'))

    await user.click(screen.getByRole('radio', { name: 'Name' }))
    await waitFor(() => expect(tagOrder()[0]).toContain('alpha'))
  })
})
