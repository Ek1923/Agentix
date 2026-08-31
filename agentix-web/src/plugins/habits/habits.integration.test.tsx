// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAIService } from '../../core/ai'
import { shiftDay } from '../../core/dates'
import { db } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import type { PluginContext } from '../../core/plugin-host/types'
import { activeAIConfig } from '../../core/settings/store'
import { habitsPlugin } from './index'

const ctx: PluginContext = {
  db: queries,
  ai: createAIService(activeAIConfig),
  navigate: () => {},
}

const Habits = habitsPlugin.Component
const today = () => queries.todayLocal()

beforeEach(async () => {
  await db.open()
  await Promise.all([db.habits.clear(), db.habitLogs.clear()])
})

afterEach(cleanup)

describe('Habits', () => {
  it('shows a real empty state', async () => {
    render(<Habits ctx={ctx} />)
    expect(await screen.findByText('No routines yet.')).toBeInTheDocument()
  })

  it('adds a daily routine when no days are picked', async () => {
    const user = userEvent.setup()
    render(<Habits ctx={ctx} />)

    await user.click(await screen.findByRole('button', { name: /Add routine/ }))
    await user.type(screen.getByLabelText('New routine'), 'Read')
    await user.click(screen.getByRole('button', { name: /^Add routine$/ }))

    expect(await screen.findByText('Read')).toBeInTheDocument()
    expect(screen.getByText(/Every day/)).toBeInTheDocument()

    const [saved] = await queries.listHabits()
    expect(saved?.daysOfWeek).toEqual([])
  })

  it('adds a routine on chosen days only', async () => {
    const user = userEvent.setup()
    render(<Habits ctx={ctx} />)

    await user.click(await screen.findByRole('button', { name: /Add routine/ }))
    await user.type(screen.getByLabelText('New routine'), 'Gym')
    await user.click(screen.getByRole('checkbox', { name: 'Mon' }))
    await user.click(screen.getByRole('checkbox', { name: 'Wed' }))
    await user.click(screen.getByRole('button', { name: /^Add routine$/ }))

    await screen.findByText('Gym')
    const [saved] = await queries.listHabits()
    expect(saved?.daysOfWeek.sort()).toEqual([1, 3])
  })

  it('ticks a routine for today and back off again', async () => {
    const user = userEvent.setup()
    await queries.createHabit('Read', [], null, 'ocean')

    render(<Habits ctx={ctx} />)
    await user.click(await screen.findByRole('checkbox', { name: /Mark "Read" done today/ }))

    await waitFor(async () => {
      const logs = await queries.listHabitLogs(today(), today())
      expect(logs).toHaveLength(1)
    })

    await user.click(await screen.findByRole('checkbox', { name: /Mark "Read" not done today/ }))
    await waitFor(async () => {
      expect(await queries.listHabitLogs(today(), today())).toEqual([])
    })
  })

  it('never writes two logs for the same day', async () => {
    const habit = await queries.createHabit('Read', [], null, 'ocean')
    await queries.setHabitDone(habit.id, today(), true)
    await queries.setHabitDone(habit.id, today(), true)

    expect(await queries.listHabitLogs(today(), today())).toHaveLength(1)
  })

  it('unticking a day that was never logged is a no-op', async () => {
    const habit = await queries.createHabit('Read', [], null, 'ocean')
    await queries.setHabitDone(habit.id, today(), false)
    expect(await queries.listHabitLogs(today(), today())).toEqual([])
  })

  it('shows a streak once days are kept', async () => {
    const habit = await queries.createHabit('Read', [], null, 'ocean')
    for (let i = 0; i < 4; i += 1) {
      await queries.setHabitDone(habit.id, shiftDay(today(), -i), true)
    }

    render(<Habits ctx={ctx} />)
    expect(await screen.findByText('4')).toBeInTheDocument()
  })

  it('disables the tick on a day the routine is not due', async () => {
    // Every weekday except today, whichever day today is.
    const todayWeekday = new Date().getDay()
    const otherDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== todayWeekday)
    await queries.createHabit('Gym', otherDays, null, 'ember')

    render(<Habits ctx={ctx} />)
    expect(await screen.findByText(/not due today/)).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: /Mark "Gym" done today/ }),
    ).toBeDisabled()
  })

  it('soft deletes a routine', async () => {
    const user = userEvent.setup()
    await queries.createHabit('Gone', [], null, 'ocean')

    render(<Habits ctx={ctx} />)
    await user.click(await screen.findByRole('button', { name: /Delete "Gone"/ }))

    await waitFor(async () => {
      expect(await queries.listHabits()).toEqual([])
    })
    // Still on disk, so the delete can sync like any other edit.
    expect(await db.habits.count()).toBe(1)
  })

  it('counts what is due and kept today', async () => {
    const habit = await queries.createHabit('Read', [], null, 'ocean')
    await queries.createHabit('Walk', [], null, 'forest')
    await queries.setHabitDone(habit.id, today(), true)

    render(<Habits ctx={ctx} />)
    expect(await screen.findByText(/1 of 2 due today/)).toBeInTheDocument()
  })
})
