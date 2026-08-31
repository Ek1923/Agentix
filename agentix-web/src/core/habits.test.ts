import { describe, expect, it } from 'vitest'
import type { Habit } from './db/types'
import {
  habitTaskId,
  isActiveOn,
  isDueOn,
  isHabitTaskId,
  isPaused,
  parseHabitTaskId,
  routinesFor,
} from './habits'

function habit(overrides: Partial<Habit> & { id: string }): Habit {
  const base: Habit = {
    id: overrides.id,
    title: overrides.id,
    daysOfWeek: [],
    estimateMin: null,
    colorId: 'slate',
    archivedAt: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    deletedAt: null,
  }
  return Object.assign(base, overrides)
}

// 2026-08-31 is a Monday.
const MONDAY = '2026-08-31'
const TUESDAY = '2026-09-01'

describe('when a routine is due', () => {
  it('treats no chosen days as every day', () => {
    expect(isDueOn(habit({ id: 'daily' }), MONDAY)).toBe(true)
    expect(isDueOn(habit({ id: 'daily' }), TUESDAY)).toBe(true)
  })

  it('honours the chosen weekdays', () => {
    const weekly = habit({ id: 'mondays', daysOfWeek: [1] })
    expect(isDueOn(weekly, MONDAY)).toBe(true)
    expect(isDueOn(weekly, TUESDAY)).toBe(false)
  })

  it('never counts a paused routine, whatever day it is', () => {
    const paused = habit({ id: 'paused', archivedAt: '2026-08-20T10:00:00.000Z' })
    expect(isPaused(paused)).toBe(true)
    expect(isDueOn(paused, MONDAY)).toBe(true)
    expect(isActiveOn(paused, MONDAY)).toBe(false)
  })
})

describe('the id a routine takes on a day', () => {
  it('is derived, so two devices produce the same one', () => {
    expect(habitTaskId('abc', MONDAY)).toBe(`habit:abc:${MONDAY}`)
    expect(habitTaskId('abc', MONDAY)).toBe(habitTaskId('abc', MONDAY))
  })

  it('reads back to the routine and the day it came from', () => {
    const id = habitTaskId('7b2f-1', TUESDAY)
    expect(parseHabitTaskId(id)).toEqual({ habitId: '7b2f-1', day: TUESDAY })
    expect(isHabitTaskId(id)).toBe(true)
  })

  it('does not mistake an ordinary task for a routine', () => {
    expect(parseHabitTaskId('9f1c8a02-0000-4000-8000-000000000000')).toBeNull()
    expect(isHabitTaskId('habit')).toBe(false)
    // Shaped like one, but the day is not a day.
    expect(parseHabitTaskId('habit:abc:not-a-day')).toBeNull()
    expect(parseHabitTaskId('habit::2026-08-31')).toBeNull()
    expect(parseHabitTaskId(`habit:abc:${MONDAY}:extra`)).toBeNull()
  })
})

describe('a day of routines', () => {
  it('carries the title and estimate the card should be made with', () => {
    const planned = routinesFor([habit({ id: 'run', title: 'Run', estimateMin: 30 })], MONDAY)

    expect(planned).toEqual([
      { taskId: `habit:run:${MONDAY}`, habitId: 'run', day: MONDAY, title: 'Run', estimateMin: 30 },
    ])
  })

  it('leaves out what is not due, and what is paused', () => {
    const planned = routinesFor(
      [
        habit({ id: 'daily' }),
        habit({ id: 'tuesdays', daysOfWeek: [2] }),
        habit({ id: 'paused', archivedAt: '2026-08-20T10:00:00.000Z' }),
      ],
      MONDAY,
    )

    expect(planned.map((routine) => routine.habitId)).toEqual(['daily'])
  })
})
