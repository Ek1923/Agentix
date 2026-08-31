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

/** The column a card currently sits in, by its accessible region label. */
function column(label: string) {
  return screen.getByRole('region', { name: label })
}

function waitForBoard() {
  return screen.findByRole('region', { name: 'To do' })
}

/** Opens the vertical-dots menu in a column header. */
async function openColumnMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Column actions for ${name}` }))
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
    db.habits.clear(),
    db.habitLogs.clear(),
  ])
})

afterEach(cleanup)

describe('board columns', () => {
  it('seeds the three built-in columns on first use', async () => {
    render(<TaskManager ctx={ctx} />)

    expect(await waitForBoard()).toBeInTheDocument()
    expect(column('In progress')).toBeInTheDocument()
    expect(column('Done')).toBeInTheDocument()
  })

  it('seeds only once, so reopening does not duplicate columns', async () => {
    const { unmount } = render(<TaskManager ctx={ctx} />)
    await waitForBoard()
    unmount()

    render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    await waitFor(async () => {
      expect(await queries.listBuckets()).toHaveLength(3)
    })
  })

  it('files each task in the column it points at', async () => {
    await queries.createTask({ title: 'Waiting', plannedFor: today() })
    await queries.createTask({
      title: 'Started',
      plannedFor: today(),
      status: 'active',
      bucketId: DEFAULT_BUCKET_IDS.active,
    })
    await queries.createTask({
      title: 'Finished',
      plannedFor: today(),
      status: 'done',
      bucketId: DEFAULT_BUCKET_IDS.done,
    })

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Waiting')

    expect(within(column('To do')).getByText('Waiting')).toBeInTheDocument()
    expect(within(column('In progress')).getByText('Started')).toBeInTheDocument()
    expect(within(column('Done')).getByText('Finished')).toBeInTheDocument()
  })

  it('renames a column, and the cards stay in it', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Stays put', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Stays put')

    const menu = await openColumnMenu(user, 'To do')
    await user.click(within(menu).getByRole('menuitem', { name: /Rename column/ }))
    const input = await screen.findByLabelText('Column name')
    await user.clear(input)
    await user.type(input, 'Backlog')
    await user.click(screen.getByRole('button', { name: /Save name/ }))

    const renamed = await screen.findByRole('region', { name: 'Backlog' })
    expect(within(renamed).getByText('Stays put')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'To do' })).not.toBeInTheDocument()
  })

  it('keeps completion counting by status after a rename', async () => {
    const user = userEvent.setup()
    await queries.createTask({
      title: 'Shipped work',
      plannedFor: today(),
      status: 'done',
      bucketId: DEFAULT_BUCKET_IDS.done,
    })

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Shipped work')

    const menu = await openColumnMenu(user, 'Done')
    await user.click(within(menu).getByRole('menuitem', { name: /Rename column/ }))
    const input = await screen.findByLabelText('Column name')
    await user.clear(input)
    await user.type(input, 'Shipped')
    await user.click(screen.getByRole('button', { name: /Save name/ }))

    await screen.findByRole('region', { name: 'Shipped' })
    // Renaming a column must not change what counts as finished.
    const bar = screen.getByRole('progressbar', { name: 'Progress today' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
  })

  it('adds a custom column', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    await user.click(screen.getByRole('button', { name: /Add column/ }))
    await user.type(screen.getByLabelText('New column'), 'Blocked')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('region', { name: 'Blocked' })).toBeInTheDocument()
  })

  it('lets a seeded column be deleted like any other', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    const menu = await openColumnMenu(user, 'To do')
    await user.click(within(menu).getByRole('menuitem', { name: /Delete column/ }))

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'To do' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('region', { name: 'In progress' })).toBeInTheDocument()
  })

  it('does not re-create a deleted column on the next mount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    const menu = await openColumnMenu(user, 'To do')
    await user.click(within(menu).getByRole('menuitem', { name: /Delete column/ }))
    await waitFor(async () => {
      expect(await queries.listBuckets()).toHaveLength(2)
    })

    // Seeding fills an empty board, never gaps — otherwise deleting a seeded
    // column would be impossible.
    unmount()
    render(<TaskManager ctx={ctx} />)
    await screen.findByRole('region', { name: 'In progress' })
    expect(screen.queryByRole('region', { name: 'To do' })).not.toBeInTheDocument()
  })

  it('refuses to remove the last column', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    for (const name of ['To do', 'In progress']) {
      const menu = await openColumnMenu(user, name)
      await user.click(within(menu).getByRole('menuitem', { name: /Delete column/ }))
      await waitFor(() => {
        expect(screen.queryByRole('region', { name })).not.toBeInTheDocument()
      })
    }

    // One column left: no delete offered, and the board still works.
    const menu = await openColumnMenu(user, 'Done')
    expect(within(menu).queryByRole('menuitem', { name: /Delete column/ })).not.toBeInTheDocument()
    expect(await queries.listBuckets()).toHaveLength(1)
  })

  it('recolours a column', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    const menu = await openColumnMenu(user, 'To do')
    await user.click(within(menu).getByRole('menuitem', { name: 'Ember' }))

    await waitFor(async () => {
      const [todo] = await queries.listBuckets()
      expect(todo?.colorId).toBe('ember')
    })
  })

  it('deleting a custom column rehomes its cards instead of losing them', async () => {
    const user = userEvent.setup()
    // Seed first: with any column already present, seeding is skipped by design.
    await queries.ensureDefaultBuckets()
    const blocked = await queries.createBucket('Blocked')
    await queries.createTask({
      title: 'Stranded',
      plannedFor: today(),
      bucketId: blocked.id,
    })

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Stranded')

    const menu = await openColumnMenu(user, 'Blocked')
    await user.click(within(menu).getByRole('menuitem', { name: /Delete column/ }))

    await waitFor(() => {
      expect(within(column('To do')).getByText('Stranded')).toBeInTheDocument()
    })
    const [task] = await queries.listTasksByDay(today())
    expect(task?.deletedAt).toBeNull()
  })
})

describe('moving cards', () => {
  it('moves a card between columns from the task panel', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Movable', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Movable')

    await user.click(screen.getByRole('button', { name: 'Movable' }))
    await user.selectOptions(await screen.findByLabelText('Column'), DEFAULT_BUCKET_IDS.active)

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.bucketId).toBe(DEFAULT_BUCKET_IDS.active)
      expect(task?.status).toBe('active')
    })
  })

  it('stamps and clears completion as a card enters and leaves Done', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Round trip', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Round trip')

    await user.click(screen.getByRole('checkbox', { name: /Mark "Round trip" done/ }))
    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.status).toBe('done')
      expect(task?.completedAt).not.toBeNull()
    })

    await user.click(
      await screen.findByRole('checkbox', { name: /Mark "Round trip" not done/ }),
    )
    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.status).toBe('todo')
      expect(task?.completedAt).toBeNull()
    })
  })

  it('does not touch updatedAt when a card lands back in its own column', async () => {
    const user = userEvent.setup()
    const created = await queries.createTask({ title: 'Stay put', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Stay put')

    await user.click(screen.getByRole('button', { name: 'Stay put' }))
    await user.selectOptions(await screen.findByLabelText('Column'), DEFAULT_BUCKET_IDS.todo)

    // A no-op write would still bump updatedAt and could win a future sync merge.
    const [task] = await queries.listTasksByDay(today())
    expect(task?.updatedAt).toBe(created.updatedAt)
  })

  it('starting a timer moves the card into In progress', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Begin', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Begin')

    await user.click(screen.getByRole('button', { name: /Start timer for "Begin"/ }))

    await waitFor(() => {
      expect(within(column('In progress')).getByText('Begin')).toBeInTheDocument()
    })
  })

  it('leaves no timer control on a card in Done', async () => {
    await queries.createTask({
      title: 'Closed',
      plannedFor: today(),
      status: 'done',
      bucketId: DEFAULT_BUCKET_IDS.done,
    })

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Closed')

    expect(
      screen.queryByRole('button', { name: /Start timer for "Closed"/ }),
    ).not.toBeInTheDocument()
  })

  it('shows progress across the day', async () => {
    await queries.createTask({
      title: 'One',
      plannedFor: today(),
      status: 'done',
      bucketId: DEFAULT_BUCKET_IDS.done,
    })
    await queries.createTask({ title: 'Two', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)

    const bar = await screen.findByRole('progressbar', { name: 'Progress today' })
    expect(bar).toHaveAttribute('aria-valuenow', '50')
  })

  it('keeps a task planned for another day off the board for today', async () => {
    await queries.createTask({ title: 'Not today', plannedFor: '2020-01-01' })

    render(<TaskManager ctx={ctx} />)
    expect(await screen.findByText('Nothing planned for today.')).toBeInTheDocument()
  })
})

describe('routines on the board', () => {
  it('shows a routine due today as a card, marked as what it is', async () => {
    await queries.createHabit('Stretch', [], 10, 'ocean')

    render(<TaskManager ctx={ctx} />)

    await waitForBoard()
    expect(await screen.findByText('Stretch')).toBeInTheDocument()
    expect(screen.getByText('Routine')).toBeInTheDocument()
  })

  it('calls removing it skipping, because the routine is back tomorrow', async () => {
    const user = userEvent.setup()
    await queries.createHabit('Stretch', [], null, 'ocean')

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Stretch')

    await user.click(screen.getByRole('button', { name: 'More actions for "Stretch"' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Skip today')).toBeInTheDocument()
    expect(within(menu).queryByText('Delete task')).not.toBeInTheDocument()
  })

  it('records the day when the card is ticked', async () => {
    const user = userEvent.setup()
    const habit = await queries.createHabit('Stretch', [], null, 'ocean')

    render(<TaskManager ctx={ctx} />)
    await screen.findByText('Stretch')

    await user.click(screen.getByRole('checkbox', { name: 'Mark "Stretch" done' }))

    await waitFor(async () => {
      const logs = await queries.listHabitLogs(today(), today())
      expect(logs.filter((log) => log.habitId === habit.id && log.deletedAt === null)).toHaveLength(
        1,
      )
    })
  })
})
