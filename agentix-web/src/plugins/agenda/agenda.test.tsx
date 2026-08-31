// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAIService } from '../../core/ai'
import { db } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import type { PluginContext } from '../../core/plugin-host/types'
import { activeAIConfig } from '../../core/settings/store'
import { agendaPlugin } from './index'
import { shiftDay, todayKey } from './logic/days'

const navigate = vi.fn()
const ctx: PluginContext = {
  db: queries,
  ai: createAIService(activeAIConfig),
  navigate,
}

const Agenda = agendaPlugin.Component

/*
  The clock is pinned to a Wednesday.

  The day strip shows exactly one week, so "tomorrow" is only on screen when today
  is not the last day of that week. Read against the real clock, these tests
  passed six days out of seven and failed on the seventh — which is the worst kind
  of test, because the failure arrives on a day nobody changed anything.

  Only `Date` is faked. Dexie's transactions run on real timers and fall over the
  moment those are replaced.
*/
const PINNED = new Date(2026, 7, 26, 10, 0, 0)

/** Derived from the pinned date through the app's own formatter, so it cannot drift. */
const today = todayKey(PINNED)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(PINNED)
  await db.open()
  await Promise.all([
    db.tasks.clear(),
    db.sessions.clear(),
    db.notes.clear(),
    db.habits.clear(),
    db.habitLogs.clear(),
  ])
  navigate.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Agenda', () => {
  it('opens on today', async () => {
    render(<Agenda ctx={ctx} />)
    expect(await screen.findByText('Today')).toBeInTheDocument()
  })

  it('shows a real empty state for a day with nothing on it', async () => {
    render(<Agenda ctx={ctx} />)
    expect(await screen.findByText('Nothing planned for today.')).toBeInTheDocument()
  })

  /** The Phase 2 gate: tasks appear on the day they were planned for, and nowhere else. */
  it('shows each task on its own day and not on others', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Today task', plannedFor: today })
    await queries.createTask({ title: 'Tomorrow task', plannedFor: shiftDay(today, 1) })

    render(<Agenda ctx={ctx} />)

    expect(await screen.findByText('Today task')).toBeInTheDocument()
    expect(screen.queryByText('Tomorrow task')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: shiftDay(today, 1) }))

    expect(await screen.findByText('Tomorrow task')).toBeInTheDocument()
    // waitFor, not queryBy: the previous day's row is still playing its exit
    // animation for a frame or two after the new day has rendered.
    await waitFor(() => {
      expect(screen.queryByText('Today task')).not.toBeInTheDocument()
    })
  })

  it('labels the selected day relative to today', async () => {
    const user = userEvent.setup()
    render(<Agenda ctx={ctx} />)
    await screen.findByText('Today')

    await user.click(screen.getByRole('radio', { name: shiftDay(today, 1) }))
    expect(await screen.findByText('Tomorrow')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: shiftDay(today, -1) }))
    expect(await screen.findByText('Yesterday')).toBeInTheDocument()
  })

  it('moves a task to another day, and it lands there', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Slipped', plannedFor: today })

    render(<Agenda ctx={ctx} />)
    await screen.findByText('Slipped')

    await user.click(screen.getByRole('button', { name: /Move "Slipped" to the next day/ }))

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(shiftDay(today, 1))
      expect(task?.title).toBe('Slipped')
    })
    // Gone from today, present tomorrow.
    expect(await queries.listTasksByDay(today)).toEqual([])
  })

  it('moves a task backwards too', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Pull forward', plannedFor: today })

    render(<Agenda ctx={ctx} />)
    await screen.findByText('Pull forward')

    await user.click(
      screen.getByRole('button', { name: /Move "Pull forward" to the previous day/ }),
    )

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(shiftDay(today, -1))
      expect(task?.title).toBe('Pull forward')
    })
  })

  it('offers a jump back to today once you have navigated away', async () => {
    const user = userEvent.setup()
    render(<Agenda ctx={ctx} />)
    await screen.findByText('Today')

    expect(screen.queryByRole('button', { name: 'Jump to today' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next week' }))
    const jump = await screen.findByRole('button', { name: 'Jump to today' })

    await user.click(jump)
    expect(await screen.findByText('Today')).toBeInTheDocument()
  })

  it('pages a whole week at a time', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Next week', plannedFor: shiftDay(today, 7) })

    render(<Agenda ctx={ctx} />)
    await screen.findByText('Today')

    await user.click(screen.getByRole('button', { name: 'Next week' }))

    expect(
      await screen.findByRole('radio', { name: shiftDay(today, 7) }),
    ).toBeInTheDocument()
  })

  it('hands navigation back through ctx rather than importing another plugin', async () => {
    const user = userEvent.setup()
    render(<Agenda ctx={ctx} />)
    await screen.findByText('Today')

    await user.click(screen.getByRole('button', { name: /Open Task Manager/ }))
    expect(navigate).toHaveBeenCalledWith('task-manager')
  })

  it('ignores soft-deleted tasks', async () => {
    const task = await queries.createTask({ title: 'Deleted', plannedFor: today })
    await queries.deleteTask(task.id)

    render(<Agenda ctx={ctx} />)
    expect(await screen.findByText('Nothing planned for today.')).toBeInTheDocument()
  })
})

describe('routines in the day view', () => {
  it('names a routine rather than offering to move it off its day', async () => {
    const habit = await queries.createHabit('Stretch', [], null, 'ocean')
    await queries.materialiseRoutines(today)

    render(<Agenda ctx={ctx} />)

    expect(await screen.findByText('Stretch')).toBeInTheDocument()
    expect(screen.getByText('Routine')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Move "Stretch" to the next day' }),
    ).not.toBeInTheDocument()
    expect(habit.id).toBeDefined()
  })
})
