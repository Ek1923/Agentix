// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAIService } from '../../core/ai'
import { shiftDay } from '../../core/dates'
import { db } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import type { PluginContext } from '../../core/plugin-host/types'
import { activeAIConfig, useSettings } from '../../core/settings/store'
import { backtestPlugin } from './index'

const ctx: PluginContext = {
  db: queries,
  ai: createAIService(activeAIConfig),
  navigate: () => {},
}

const Backtest = backtestPlugin.Component
const today = () => queries.todayLocal()
const daysAgo = (n: number) => shiftDay(today(), -n)

/**
 * Tracks `minutes` against a task, starting at `hour` local on a day `daysBack`
 * ago — the same shape a real timer leaves behind.
 */
async function track(taskId: string, daysBack: number, hour: number, minutes: number) {
  const session = await queries.startSession(taskId)
  const start = new Date()
  start.setDate(start.getDate() - daysBack)
  start.setHours(hour, 0, 0, 0)
  await db.sessions.update(session.id, {
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
  })
}

/** The value inside one summary tile, so a figure repeated elsewhere cannot match. */
function statValue(label: string, value: string) {
  const summary = screen.getByRole('group', { name: 'Summary' })
  const tile = within(summary).getByText(label).closest('div')
  expect(tile).not.toBeNull()
  return within(tile!).getByText(value)
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
  localStorage.clear()
  useSettings.setState({ backtestWindow: 10 })
})

afterEach(cleanup)

describe('the window selector', () => {
  it('offers 5, 10, 15, 20 and 30 days, defaulting to 10', async () => {
    render(<Backtest ctx={ctx} />)

    for (const days of [5, 10, 15, 20, 30]) {
      expect(
        await screen.findByRole('radio', { name: `Last ${days} days` }),
      ).toBeInTheDocument()
    }
    expect(screen.getByRole('radio', { name: 'Last 10 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('persists the choice across a reload', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Backtest ctx={ctx} />)

    await user.click(await screen.findByRole('radio', { name: 'Last 30 days' }))
    expect(useSettings.getState().backtestWindow).toBe(30)

    unmount()
    await useSettings.persist.rehydrate()
    render(<Backtest ctx={ctx} />)

    expect(await screen.findByRole('radio', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  /**
   * The Phase 5 gate, half one: switching the window recomputes rather than
   * re-fetching. Everything is read once at the widest window and sliced in memory.
   */
  it('recomputes on a window change without going back to the database', async () => {
    const user = userEvent.setup()
    const task = await queries.createTask({ title: 'Worked', plannedFor: daysAgo(2) })
    await track(task.id, 2, 9, 60)

    const listRecentTasks = vi.spyOn(queries, 'listRecentTasks')
    const listSessionsInRange = vi.spyOn(queries, 'listSessionsInRange')

    render(<Backtest ctx={ctx} />)
    await screen.findByText('Focus time')

    const tasksBefore = listRecentTasks.mock.calls.length
    const sessionsBefore = listSessionsInRange.mock.calls.length

    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }))
    await waitFor(() => {
      expect(screen.getByText(/of 30 days had something recorded/)).toBeInTheDocument()
    })
    await user.click(screen.getByRole('radio', { name: 'Last 5 days' }))
    await waitFor(() => {
      expect(screen.getByText(/of 5 days had something recorded/)).toBeInTheDocument()
    })

    expect(listRecentTasks.mock.calls.length).toBe(tasksBefore)
    expect(listSessionsInRange.mock.calls.length).toBe(sessionsBefore)

    listRecentTasks.mockRestore()
    listSessionsInRange.mockRestore()
  })

  it('narrows what is counted when the window shrinks', async () => {
    const user = userEvent.setup()
    const old = await queries.createTask({ title: 'Old work', plannedFor: daysAgo(20) })
    await track(old.id, 20, 9, 120)

    render(<Backtest ctx={ctx} />)
    await screen.findByRole('radio', { name: 'Last 30 days' })

    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }))
    await waitFor(() => {
      expect(statValue('Focus', '2h')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('radio', { name: 'Last 5 days' }))
    expect(
      await screen.findByText('Nothing recorded in this window.'),
    ).toBeInTheDocument()
  })
})

describe('the numbers', () => {
  it('says nothing was recorded rather than showing zeroes', async () => {
    render(<Backtest ctx={ctx} />)
    expect(await screen.findByText('Nothing recorded in this window.')).toBeInTheDocument()
  })

  /** The Phase 5 gate, half two: the numbers match what actually happened. */
  it('reports completion, focus and the longest run from real records', async () => {
    const done = await queries.createTask({ title: 'Finished', plannedFor: daysAgo(1) })
    await queries.createTask({ title: 'Not finished', plannedFor: daysAgo(1) })
    await track(done.id, 1, 9, 90)
    await track(done.id, 1, 14, 30)
    await queries.setTaskDone(done.id, true)

    render(<Backtest ctx={ctx} />)
    await screen.findByText('Completed')

    // One of two planned finished; two hours tracked; longest run 90 minutes.
    expect(statValue('Completed', '50%')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 planned')).toBeInTheDocument()
    expect(statValue('Focus', '2h')).toBeInTheDocument()
    expect(statValue('Longest run', '1h 30m')).toBeInTheDocument()
  })

  it('records the first clock-in and last clock-out of a day', async () => {
    const task = await queries.createTask({ title: 'Long day', plannedFor: daysAgo(1) })
    await track(task.id, 1, 8, 60)
    await track(task.id, 1, 17, 60)

    render(<Backtest ctx={ctx} />)
    await screen.findByText('Clock in, clock out')

    const table = screen.getByRole('table')
    expect(within(table).getByText('08:00')).toBeInTheDocument()
    expect(within(table).getByText('18:00')).toBeInTheDocument()
  })

  it('leaves untracked days out of the clock table', async () => {
    const task = await queries.createTask({ title: 'One day', plannedFor: daysAgo(1) })
    await track(task.id, 1, 9, 60)

    render(<Backtest ctx={ctx} />)
    await screen.findByText('Clock in, clock out')

    // Ten days in the window, one with anything on it.
    expect(screen.getAllByRole('row')).toHaveLength(2) // header + one day
  })
})

describe('estimate accuracy', () => {
  it('scores a finished, estimated, tracked task', async () => {
    const task = await queries.createTask({
      title: 'Underestimated',
      plannedFor: daysAgo(1),
      estimateMin: 60,
    })
    await track(task.id, 1, 9, 120)
    await queries.setTaskDone(task.id, true)

    render(<Backtest ctx={ctx} />)
    await screen.findByText('Estimate accuracy')

    expect(
      screen.getByText('Work takes about 100% longer than estimated.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 finished task with an estimate/)).toBeInTheDocument()
  })

  it('refuses to score what it cannot measure, and says how much it skipped', async () => {
    // No estimate, so there is nothing to be accurate against.
    const task = await queries.createTask({ title: 'Unestimated', plannedFor: daysAgo(1) })
    await track(task.id, 1, 9, 60)
    await queries.setTaskDone(task.id, true)

    render(<Backtest ctx={ctx} />)
    await screen.findByText('Estimate accuracy')

    expect(screen.getByText('Nothing scorable yet')).toBeInTheDocument()
    expect(
      screen.getByText(/1 finished task could not be scored/),
    ).toBeInTheDocument()
  })

  it('labels every segment, so identity is never colour alone', async () => {
    const task = await queries.createTask({
      title: 'Scored',
      plannedFor: daysAgo(1),
      estimateMin: 60,
    })
    await track(task.id, 1, 9, 60)
    await queries.setTaskDone(task.id, true)

    render(<Backtest ctx={ctx} />)
    await screen.findByText('Estimate accuracy')

    for (const label of ['Faster', 'On target', 'Slower']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})
