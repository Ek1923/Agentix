// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

/** The board renders nothing until the built-in columns exist. */
async function waitForBoard() {
  return screen.findByRole('region', { name: 'To do' })
}

/** Opens the collapsed composer, which starts as a single "+ Add task" button. */
async function openComposer(user: ReturnType<typeof userEvent.setup>) {
  await waitForBoard()
  await user.click(screen.getByRole('button', { name: /Add task/ }))
  return screen.findByLabelText('New task')
}

afterEach(cleanup)

async function addTask(user: ReturnType<typeof userEvent.setup>, title: string) {
  if (screen.queryByLabelText('New task') === null) await openComposer(user)
  await user.type(screen.getByLabelText('New task'), title)
  await user.click(screen.getAllByRole('button', { name: /Add task/ }).at(-1)!)
  return screen.findByText(title)
}

describe('Task Manager', () => {
  it('shows a real empty state before anything is planned', async () => {
    render(<TaskManager ctx={ctx} />)
    expect(await screen.findByText('Nothing planned for today.')).toBeInTheDocument()
  })

  it('creates a task on today, with estimate and priority', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    await openComposer(user)
    await user.type(screen.getByLabelText('New task'), 'Write the brief')
    await user.type(screen.getByLabelText('Estimate'), '45')
    await user.click(screen.getByRole('radio', { name: 'Urgent' }))
    await user.click(screen.getAllByRole('button', { name: /Add task/ }).at(-1)!)

    expect(await screen.findByText('Write the brief')).toBeInTheDocument()

    const [saved] = await queries.listTasksByDay(queries.todayLocal())
    expect(saved?.title).toBe('Write the brief')
    expect(saved?.estimateMin).toBe(45)
    expect(saved?.priority).toBe(2)
    expect(saved?.status).toBe('todo')
  })

  it('clears the composer after adding, ready for the next one', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()
    await addTask(user, 'First')

    expect((screen.getByLabelText('New task') as HTMLInputElement).value).toBe('')
  })

  it('ticks a task done and un-ticks it', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()
    await addTask(user, 'Ship it')

    await user.click(screen.getByRole('checkbox', { name: /Mark "Ship it" done/ }))

    await waitFor(async () => {
      const [saved] = await queries.listTasksByDay(queries.todayLocal())
      expect(saved?.status).toBe('done')
      expect(saved?.completedAt).not.toBeNull()
    })

    // findBy, not getBy: the row must have re-rendered from the live query before
    // the un-tick control exists under its new label.
    await user.click(await screen.findByRole('checkbox', { name: /Mark "Ship it" not done/ }))

    await waitFor(async () => {
      const [saved] = await queries.listTasksByDay(queries.todayLocal())
      expect(saved?.status).toBe('todo')
      expect(saved?.completedAt).toBeNull()
    })
  })

  it('soft deletes a task', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()
    await addTask(user, 'Mistake')

    // Deleting lives on the task panel now, so open the task first.
    await user.click(screen.getByRole('button', { name: 'Mistake' }))
    await user.click(await screen.findByRole('button', { name: /Delete task/ }))

    await waitFor(async () => {
      expect(await queries.listTasksByDay(queries.todayLocal())).toEqual([])
    })
    // The row is still on disk so the delete can sync like any other edit.
    expect(await db.tasks.count()).toBe(1)
  })
})

describe('the timer', () => {
  it('writes a session on clock in and closes it on clock out', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()
    await addTask(user, 'Deep work')

    await user.click(screen.getByRole('button', { name: /Start timer for "Deep work"/ }))

    const running = await waitFor(async () => {
      const session = await queries.getRunningSession()
      expect(session).toBeDefined()
      return session!
    })
    expect(running.endedAt).toBeNull()
    expect(running.source).toBe('timer')

    await user.click(await screen.findByRole('button', { name: /Stop timer for "Deep work"/ }))

    await waitFor(async () => {
      expect(await queries.getRunningSession()).toBeUndefined()
    })
    const closed = await db.sessions.get(running.id)
    expect(closed?.endedAt).not.toBeNull()
  })

  it('moves a task into In progress when its timer starts, and leaves it there when stopped', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()
    await addTask(user, 'Focus')

    await user.click(screen.getByRole('button', { name: /Start timer for "Focus"/ }))
    await waitFor(async () => {
      const [t] = await queries.listTasksByDay(queries.todayLocal())
      expect(t?.status).toBe('active')
    })

    await user.click(await screen.findByRole('button', { name: /Stop timer for "Focus"/ }))
    await waitFor(async () => {
      expect(await queries.getRunningSession()).toBeUndefined()
    })

    // Still In progress. Pausing work is not the same as never having started it,
    // so the card stays in the bucket the person put it in.
    const [task] = await queries.listTasksByDay(queries.todayLocal())
    expect(task?.status).toBe('active')
  })

  /**
   * The Phase 1 gate. A closed tab unmounts everything, so any timer held in React
   * state or a counter would be lost. It survives because the running session is a
   * row with `endedAt: null` and elapsed time is derived from `startedAt`.
   */
  it('survives a tab close mid-session and is still running on reopen', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<TaskManager ctx={ctx} />)
    await waitForBoard()
    await addTask(user, 'Long haul')

    await user.click(screen.getByRole('button', { name: /Start timer for "Long haul"/ }))
    const before = await waitFor(async () => {
      const session = await queries.getRunningSession()
      expect(session).toBeDefined()
      return session!
    })

    // Close the tab.
    unmount()

    // The session is untouched by the UI going away.
    const stillOpen = await queries.getRunningSession()
    expect(stillOpen?.id).toBe(before.id)
    expect(stillOpen?.endedAt).toBeNull()

    // Reopen: the row is found again and the timer reads as running.
    render(<TaskManager ctx={ctx} />)
    expect(
      await screen.findByRole('button', { name: /Stop timer for "Long haul"/ }),
    ).toBeInTheDocument()
    expect(await screen.findByLabelText('Time on this task')).toBeInTheDocument()
  })

  it('accrues elapsed time across a close and reopen, not just from reopen', async () => {
    const task = await queries.createTask({ title: 'Started earlier' })

    // A session opened twenty minutes ago, as if the tab had been closed since.
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60_000).toISOString()
    const session = await queries.startSession(task.id)
    await db.sessions.update(session.id, { startedAt: twentyMinutesAgo })

    render(<TaskManager ctx={ctx} />)

    // Reads ~20 minutes, so the clock came from the timestamp and not from mount.
    const clock = await screen.findByLabelText('Time on this task')
    expect(clock.textContent).toMatch(/^0:(19|20|21):/)
  })

  it('starting a second timer closes the first, so only one ever runs', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()
    await addTask(user, 'Alpha')
    await addTask(user, 'Beta')

    // Waits are on the database, not the render. Starting a timer moves the card
    // to another column, and asserting through the remount only measures how fast
    // the machine is — the invariant under test is which session is open.
    await user.click(await screen.findByRole('button', { name: /Start timer for "Alpha"/ }))
    await waitFor(async () => {
      expect((await queries.getRunningSession())?.taskId).toBeDefined()
    })

    await user.click(await screen.findByRole('button', { name: /Start timer for "Beta"/ }))

    await waitFor(async () => {
      const beta = (await queries.listTasksByDay(queries.todayLocal())).find(
        (t) => t.title === 'Beta',
      )
      expect((await queries.getRunningSession())?.taskId).toBe(beta?.id)
    })

    // Exactly one clock is ever open, whatever the UI is doing.
    const open = await db.sessions.filter((s) => s.endedAt === null).toArray()
    expect(open).toHaveLength(1)
  })

  it('stops the clock when a running task is ticked done', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()
    await addTask(user, 'Finish up')

    await user.click(screen.getByRole('button', { name: /Start timer for "Finish up"/ }))
    await screen.findByRole('button', { name: /Stop timer for "Finish up"/ })

    await user.click(screen.getByRole('checkbox', { name: /Mark "Finish up" done/ }))

    await waitFor(async () => {
      expect(await queries.getRunningSession()).toBeUndefined()
    })
  })

  it('offers no timer on a finished task', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()
    await addTask(user, 'Already done')

    await user.click(screen.getByRole('checkbox', { name: /Mark "Already done" done/ }))

    /*
      Wait for the flipped label, not for the timer to disappear.

      Absence is not a thing you can wait for reliably: under load the board has
      not re-rendered yet, so "no timer" is briefly true for the wrong reason and
      briefly false again after. The label turning over is positive proof the
      write landed and the card re-rendered, and only then does the absence below
      mean anything.
    */
    await screen.findByRole('checkbox', { name: /Mark "Already done" not done/ })

    /*
      Then wait the card out of its old column. A card that changes column is
      mounted twice for the length of its exit animation, and the copy on the way
      out still carries the timer it had before. Under a loaded suite that exit
      outlasts the default one-second window.
    */
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Start timer for "Already done"/ }),
      ).not.toBeInTheDocument()
    })
  })

  it('keeps many sessions on one task rather than one running total', async () => {
    const user = userEvent.setup()
    render(<TaskManager ctx={ctx} />)
    await waitForBoard()
    await addTask(user, 'Split by lunch')

    for (let i = 0; i < 2; i++) {
      await user.click(
        await screen.findByRole('button', { name: /Start timer for "Split by lunch"/ }),
      )
      await user.click(
        await screen.findByRole('button', { name: /Stop timer for "Split by lunch"/ }),
      )
    }

    const [task] = await queries.listTasksByDay(queries.todayLocal())
    const sessions = await queries.listSessionsForTask(task!.id)
    expect(sessions).toHaveLength(2)
  })
})
