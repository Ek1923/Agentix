// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAIService } from '../../core/ai'
import { db, DEFAULT_BUCKET_IDS } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import type { PluginContext } from '../../core/plugin-host/types'
import { activeAIConfig } from '../../core/settings/store'
import { taskManagerPlugin } from './index'

const ctx: PluginContext = {
  db: queries,
  ai: createAIService(activeAIConfig),
  navigate: () => {},
}

const TaskManager = taskManagerPlugin.Component
const today = () => queries.todayLocal()

/** Opens the vertical-dots menu on a card. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  await screen.findByText(title)
  await user.click(screen.getByRole('button', { name: `More actions for "${title}"` }))
  return screen.findByRole('menu')
}

beforeEach(async () => {
  await db.open()
  await Promise.all([
    db.tasks.clear(),
    db.sessions.clear(),
    db.notes.clear(),
    db.buckets.clear(),
    db.people.clear(),
  ])
})

afterEach(cleanup)

describe('the card menu', () => {
  it('sits on every card and opens on click', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Has a menu', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const trigger = await screen.findByRole('button', {
      name: 'More actions for "Has a menu"',
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('offers rename, details, a move target, and delete', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Full menu', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const menu = await openMenu(user, 'Full menu')

    expect(within(menu).getByRole('menuitem', { name: /Rename/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Open details/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Delete task/ })).toBeInTheDocument()
    expect(within(menu).getByText('Move to')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Escapable', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    await openMenu(user, 'Escapable')

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('closes when something outside it is clicked', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Click away', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    await openMenu(user, 'Click away')

    await user.click(document.body)
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })
})

describe('renaming from the menu', () => {
  it('renames a task', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Old title', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const menu = await openMenu(user, 'Old title')
    await user.click(within(menu).getByRole('menuitem', { name: /Rename/ }))

    const input = await screen.findByLabelText('Task title')
    await user.clear(input)
    await user.type(input, 'New title')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.title).toBe('New title')
    })
  })

  it('renames on Enter', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Enter me', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const menu = await openMenu(user, 'Enter me')
    await user.click(within(menu).getByRole('menuitem', { name: /Rename/ }))

    const input = await screen.findByLabelText('Task title')
    await user.clear(input)
    await user.type(input, 'Renamed{Enter}')

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.title).toBe('Renamed')
    })
  })

  it('abandons the rename on Escape', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Keep me', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const menu = await openMenu(user, 'Keep me')
    await user.click(within(menu).getByRole('menuitem', { name: /Rename/ }))

    const input = await screen.findByLabelText('Task title')
    await user.clear(input)
    await user.type(input, 'Discarded{Escape}')

    const [task] = await queries.listTasksByDay(today())
    expect(task?.title).toBe('Keep me')
    expect(await screen.findByText('Keep me')).toBeInTheDocument()
  })

  it('refuses to blank out a title', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Not blank', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const menu = await openMenu(user, 'Not blank')
    await user.click(within(menu).getByRole('menuitem', { name: /Rename/ }))

    const input = await screen.findByLabelText('Task title')
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const [task] = await queries.listTasksByDay(today())
    expect(task?.title).toBe('Not blank')
  })
})

describe('moving and deleting from the menu', () => {
  it('lists only columns the task is not already in', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'In To do', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const menu = await openMenu(user, 'In To do')

    expect(within(menu).getByRole('menuitem', { name: /In progress/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Done/ })).toBeInTheDocument()
    // Offering a move to where it already sits is an item that does nothing.
    expect(within(menu).queryByRole('menuitem', { name: /To do/ })).not.toBeInTheDocument()
  })

  it('moves a task to a chosen column', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Movable', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const menu = await openMenu(user, 'Movable')
    await user.click(within(menu).getByRole('menuitem', { name: /In progress/ }))

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.bucketId).toBe(DEFAULT_BUCKET_IDS.active)
      expect(task?.status).toBe('active')
    })
  })

  it('includes a custom column as a move target', async () => {
    const user = userEvent.setup()
    const blocked = await queries.createBucket('Blocked')
    await queries.createTask({ title: 'Stuck', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const menu = await openMenu(user, 'Stuck')
    await user.click(within(menu).getByRole('menuitem', { name: /Blocked/ }))

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.bucketId).toBe(blocked.id)
      // A column someone invented holds open work, whatever it is called.
      expect(task?.status).toBe('todo')
    })
  })

  it('deletes a task, softly', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Delete me', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const menu = await openMenu(user, 'Delete me')
    await user.click(within(menu).getByRole('menuitem', { name: /Delete task/ }))

    await waitFor(async () => {
      expect(await queries.listTasksByDay(today())).toEqual([])
    })
    // Still on disk, so the delete can sync like any other edit.
    expect(await db.tasks.count()).toBe(1)
  })

  it('stops a running timer when the task is deleted', async () => {
    const user = userEvent.setup()
    const task = await queries.createTask({ title: 'Running', plannedFor: today() })
    await queries.startSession(task.id)

    render(<TaskManager ctx={ctx} />)
    const menu = await openMenu(user, 'Running')
    await user.click(within(menu).getByRole('menuitem', { name: /Delete task/ }))

    await waitFor(async () => {
      expect(await queries.getRunningSession()).toBeUndefined()
    })
  })

  it('opens the detail panel from the menu', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Show me', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const menu = await openMenu(user, 'Show me')
    await user.click(within(menu).getByRole('menuitem', { name: /Open details/ }))

    expect(await screen.findByRole('dialog', { name: 'Show me' })).toBeInTheDocument()
  })
})
