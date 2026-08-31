// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAIService } from '../../core/ai'
import { db } from '../../core/db/db'
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

function waitForBoard() {
  return screen.findByRole('region', { name: 'To do' })
}

async function openColumnMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Column actions for ${name}` }))
  return screen.findByRole('menu')
}

async function openTask(user: ReturnType<typeof userEvent.setup>, title: string) {
  await screen.findByText(title)
  await user.click(screen.getByRole('button', { name: title }))
  return screen.findByRole('dialog', { name: title })
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

describe('column order', () => {
  it('moves a column right, and the change sticks', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    const menu = await openColumnMenu(user, 'To do')
    await user.click(within(menu).getByRole('menuitem', { name: /Move right/ }))

    await waitFor(async () => {
      const buckets = await queries.listBuckets()
      expect(buckets.map((b) => b.name)).toEqual(['In progress', 'To do', 'Done'])
    })
  })

  it('moves a column left again', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    const menu = await openColumnMenu(user, 'Done')
    await user.click(within(menu).getByRole('menuitem', { name: /Move left/ }))

    await waitFor(async () => {
      const buckets = await queries.listBuckets()
      expect(buckets.map((b) => b.name)).toEqual(['To do', 'Done', 'In progress'])
    })
  })

  it('offers no move past either end', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    const first = await openColumnMenu(user, 'To do')
    expect(within(first).queryByRole('menuitem', { name: /Move left/ })).not.toBeInTheDocument()
    expect(within(first).getByRole('menuitem', { name: /Move right/ })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    const last = await openColumnMenu(user, 'Done')
    expect(within(last).queryByRole('menuitem', { name: /Move right/ })).not.toBeInTheDocument()
  })

  it('leaves the cards with their column', async () => {
    const user = userEvent.setup()
    await queries.ensureDefaultBuckets()
    await queries.createTask({ title: 'Travels along', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Travels along')

    const menu = await openColumnMenu(user, 'To do')
    await user.click(within(menu).getByRole('menuitem', { name: /Move right/ }))

    await waitFor(() => {
      const column = screen.getByRole('region', { name: 'To do' })
      expect(within(column).getByText('Travels along')).toBeInTheDocument()
    })
  })
})

describe('tagging a task', () => {
  it('adds a tag from the detail panel', async () => {
    const user = userEvent.setup()
    await queries.ensureDefaultBuckets()
    await queries.createTask({ title: 'Needs a tag', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Needs a tag')

    await user.type(within(dialog).getByLabelText('Add a tag'), 'Design{Enter}')

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      // Normalised on the way in, so a tag typed here matches one typed anywhere.
      expect(task?.tags).toEqual(['design'])
    })
  })

  it('normalises a hash and casing, and never duplicates', async () => {
    const user = userEvent.setup()
    await queries.ensureDefaultBuckets()
    await queries.createTask({ title: 'Tagged', plannedFor: today(), tags: ['design'] })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Tagged')

    await user.type(within(dialog).getByLabelText('Add a tag'), '#DESIGN{Enter}')

    const [task] = await queries.listTasksByDay(today())
    expect(task?.tags).toEqual(['design'])
  })

  it('commits on a comma as well as Enter', async () => {
    const user = userEvent.setup()
    await queries.ensureDefaultBuckets()
    await queries.createTask({ title: 'Comma', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Comma')

    await user.type(within(dialog).getByLabelText('Add a tag'), 'admin,')

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.tags).toEqual(['admin'])
    })
  })

  it('removes a tag', async () => {
    const user = userEvent.setup()
    await queries.ensureDefaultBuckets()
    await queries.createTask({ title: 'Drop it', plannedFor: today(), tags: ['admin'] })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Drop it')

    await user.click(within(dialog).getByRole('button', { name: 'Remove tag admin' }))

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.tags).toEqual([])
    })
  })

  it('suggests tags already used elsewhere', async () => {
    const user = userEvent.setup()
    await queries.ensureDefaultBuckets()
    await queries.createTask({ title: 'Has one', plannedFor: today(), tags: ['invoices'] })
    await queries.createTask({ title: 'Has none', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Has none')

    await user.click(within(dialog).getByRole('button', { name: 'invoices' }))

    await waitFor(async () => {
      const tasks = await queries.listTasksByDay(today())
      const target = tasks.find((t) => t.title === 'Has none')
      expect(target?.tags).toEqual(['invoices'])
    })
  })

  it('shows tags on the card', async () => {
    await queries.ensureDefaultBuckets()
    await queries.createTask({ title: 'Visible', plannedFor: today(), tags: ['design'] })

    render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    const column = screen.getByRole('region', { name: 'To do' })
    expect(within(column).getByText('design')).toBeInTheDocument()
  })
})
