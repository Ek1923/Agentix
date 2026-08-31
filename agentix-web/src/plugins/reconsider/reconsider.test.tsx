// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAIService } from '../../core/ai'
import { shiftDay } from '../../core/dates'
import { db } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import type { PluginContext } from '../../core/plugin-host/types'
import { activeAIConfig } from '../../core/settings/store'
import { reconsiderPlugin } from './index'

const ctx: PluginContext = {
  db: queries,
  ai: createAIService(activeAIConfig),
  navigate: () => {},
}

const Reconsider = reconsiderPlugin.Component
const today = () => queries.todayLocal()
const daysAgo = (n: number) => shiftDay(today(), -n)

/** A closed session of a given length against a task, dated in the past. */
async function trackMinutes(taskId: string, minutes: number) {
  const session = await queries.startSession(taskId)
  const start = Date.now() - 3 * 86_400_000
  await db.sessions.update(session.id, {
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + minutes * 60_000).toISOString(),
  })
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
  await queries.ensureDefaultBuckets()
})

afterEach(cleanup)

describe('what it surfaces', () => {
  it('celebrates having nothing left behind', async () => {
    await queries.createTask({ title: 'On track', plannedFor: today() })

    render(<Reconsider ctx={ctx} />)
    expect(await screen.findByText('Nothing left behind.')).toBeInTheDocument()
  })

  it("says nothing about today's work, which has not been missed yet", async () => {
    await queries.createTask({ title: 'Due today', plannedFor: today() })

    render(<Reconsider ctx={ctx} />)
    await screen.findByText('Nothing left behind.')
    expect(screen.queryByText('Due today')).not.toBeInTheDocument()
  })

  it('leaves finished work alone', async () => {
    const task = await queries.createTask({ title: 'Finished late', plannedFor: daysAgo(3) })
    await queries.setTaskDone(task.id, true)

    render(<Reconsider ctx={ctx} />)
    expect(await screen.findByText('Nothing left behind.')).toBeInTheDocument()
  })

  it('surfaces work whose day has passed', async () => {
    await queries.createTask({ title: 'Slipped', plannedFor: daysAgo(2) })

    render(<Reconsider ctx={ctx} />)
    expect(await screen.findByText('Slipped')).toBeInTheDocument()
  })

  /**
   * The Phase 4 gate: suggestions must come from real data, not invented data.
   * Each reason below states numbers that are true of that specific task.
   */
  it('explains each suggestion with the numbers it was built from', async () => {
    const user = userEvent.setup()
    const started = await queries.createTask({
      title: 'Half done',
      plannedFor: daysAgo(2),
    })
    await trackMinutes(started.id, 45)
    await queries.createTask({ title: 'Never touched', plannedFor: daysAgo(1) })
    // 14 days is both inside the default window and at the staleness threshold.
    await queries.createTask({ title: 'Long forgotten', plannedFor: daysAgo(14) })

    render(<Reconsider ctx={ctx} />)
    await screen.findByText('Half done')
    // 30d, so the 14-day-old fixture is not sitting on the window boundary.
    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }))
    await screen.findByText('Long forgotten')

    expect(
      screen.getByText('45m already tracked, then it stalled 2 days ago.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Planned 1 day ago and never started.')).toBeInTheDocument()
    expect(
      screen.getByText('Open 14 days past its day and never started.'),
    ).toBeInTheDocument()
  })

  it('offers to resume started work, and to question untouched old work', async () => {
    const user = userEvent.setup()
    const started = await queries.createTask({ title: 'Started', plannedFor: daysAgo(3) })
    await trackMinutes(started.id, 30)
    await queries.createTask({ title: 'Stale', plannedFor: daysAgo(14) })

    render(<Reconsider ctx={ctx} />)
    await screen.findByText('Started')
    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }))
    await screen.findByText('Stale')

    const items = screen.getAllByRole('listitem')
    // Started work leads: abandoning it wastes something real.
    expect(within(items[0]!).getByText('Pick this back up')).toBeInTheDocument()
    expect(within(items[0]!).getByText('Started')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Still worth doing?')).toBeInTheDocument()
  })

  it('reports the time stranded in unfinished work', async () => {
    const a = await queries.createTask({ title: 'A', plannedFor: daysAgo(2) })
    const b = await queries.createTask({ title: 'B', plannedFor: daysAgo(2) })
    await trackMinutes(a.id, 30)
    await trackMinutes(b.id, 45)

    render(<Reconsider ctx={ctx} />)
    expect(await screen.findByText(/1h 15m already invested/)).toBeInTheDocument()
  })
})

describe('the look-back window', () => {
  it('defaults to 14 days', async () => {
    render(<Reconsider ctx={ctx} />)
    expect(await screen.findByRole('radio', { name: 'Last 14 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('a narrower window hides older misses', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Ten days ago', plannedFor: daysAgo(10) })

    render(<Reconsider ctx={ctx} />)
    await screen.findByText('Ten days ago')

    await user.click(screen.getByRole('radio', { name: 'Last 7 days' }))

    await waitFor(() => {
      expect(screen.queryByText('Ten days ago')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Nothing left behind.')).toBeInTheDocument()
  })

  it('a wider window brings them back', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Twenty days ago', plannedFor: daysAgo(20) })

    render(<Reconsider ctx={ctx} />)
    await screen.findByText('Nothing left behind.')

    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }))
    expect(await screen.findByText('Twenty days ago')).toBeInTheDocument()
  })
})

describe('acting on a suggestion', () => {
  it('moves a task to today', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Bring forward', plannedFor: daysAgo(3) })

    render(<Reconsider ctx={ctx} />)
    await screen.findByText('Bring forward')
    await user.click(screen.getByRole('button', { name: /Do today/ }))

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.title).toBe('Bring forward')
    })
    // And it leaves the list, because it is no longer overdue.
    await waitFor(() => {
      expect(screen.getByText('Nothing left behind.')).toBeInTheDocument()
    })
  })

  it('moves a task to tomorrow rather than piling it onto today', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Push out', plannedFor: daysAgo(3) })

    render(<Reconsider ctx={ctx} />)
    await screen.findByText('Push out')
    await user.click(screen.getByRole('button', { name: /Tomorrow/ }))

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(shiftDay(today(), 1))
      expect(task?.title).toBe('Push out')
    })
  })

  it('marks a task done, keeping status, column and timer in agreement', async () => {
    const user = userEvent.setup()
    const task = await queries.createTask({ title: 'Actually done', plannedFor: daysAgo(2) })
    await queries.startSession(task.id)

    render(<Reconsider ctx={ctx} />)
    await screen.findByText('Actually done')
    await user.click(screen.getByRole('button', { name: /Already done/ }))

    await waitFor(async () => {
      const saved = await queries.getTask(task.id)
      expect(saved?.status).toBe('done')
      expect(saved?.completedAt).not.toBeNull()
      expect(saved?.bucketId).toBe('bucket-done')
    })
    // Finished work stops accruing time.
    expect(await queries.getRunningSession()).toBeUndefined()
  })

  it('drops a task with a soft delete', async () => {
    const user = userEvent.setup()
    // Comfortably inside the default window; the Drop button exists on every kind.
    await queries.createTask({ title: 'Not happening', plannedFor: daysAgo(10) })

    render(<Reconsider ctx={ctx} />)
    await screen.findByText('Not happening')
    await user.click(screen.getByRole('button', { name: /Drop "Not happening"/ }))

    await waitFor(async () => {
      expect(await queries.listRecentTasks(30)).toEqual([])
    })
    // Still on disk, so the delete can sync like any other edit.
    expect(await db.tasks.count()).toBe(1)
  })

  it('keeps tracked time with a task that is moved forward', async () => {
    const user = userEvent.setup()
    const task = await queries.createTask({ title: 'Resume me', plannedFor: daysAgo(3) })
    await trackMinutes(task.id, 40)

    render(<Reconsider ctx={ctx} />)
    await screen.findByText('Resume me')
    await user.click(screen.getByRole('button', { name: /Finish today/ }))

    await waitFor(async () => {
      const moved = await queries.getTask(task.id)
      expect(moved?.plannedFor).toBe(today())
    })
    // Moving a day must not lose the work already done on it.
    expect(await queries.listSessionsForTask(task.id)).toHaveLength(1)
  })
})
