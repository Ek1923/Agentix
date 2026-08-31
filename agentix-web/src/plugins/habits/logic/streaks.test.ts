import { describe, expect, it } from 'vitest'
import { shiftDay } from '../../../core/dates'
import type { Habit, HabitLog } from '../../../core/db/types'
import {
  describeCadence,
  dueDaysBetween,
  isDueOn,
  isValidHabitTitle,
  progressFor,
  streakFor,
  summarise,
} from './streaks'

// 2026-08-27 is a Thursday.
const TODAY = '2026-08-27'

function habit(overrides: Partial<Habit> & { id: string }): Habit {
  const base: Habit = {
    id: overrides.id,
    title: overrides.id,
    daysOfWeek: [],
    estimateMin: null,
    colorId: 'ocean',
    archivedAt: null,
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
    deletedAt: null,
  }
  return Object.assign(base, overrides)
}

function logsFor(habitId: string, days: string[]): HabitLog[] {
  return days.map((day, i) => ({
    id: `${habitId}-${i}`,
    habitId,
    day,
    completedAt: `${day}T12:00:00.000Z`,
    createdAt: `${day}T12:00:00.000Z`,
    updatedAt: `${day}T12:00:00.000Z`,
    deletedAt: null,
  }))
}

/** The last `n` days ending today, oldest first. */
function lastDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftDay(TODAY, -(n - 1 - i)))
}

describe('isDueOn', () => {
  it('treats no constraint as every day', () => {
    const daily = habit({ id: 'daily' })
    expect(isDueOn(daily, TODAY)).toBe(true)
    expect(isDueOn(daily, shiftDay(TODAY, 1))).toBe(true)
  })

  it('honours specific weekdays', () => {
    // Thursday is 4.
    const thursdays = habit({ id: 'thu', daysOfWeek: [4] })
    expect(isDueOn(thursdays, TODAY)).toBe(true)
    expect(isDueOn(thursdays, shiftDay(TODAY, 1))).toBe(false)
  })
})

describe('describeCadence', () => {
  it('names the common patterns', () => {
    expect(describeCadence(habit({ id: 'a' }))).toBe('Every day')
    expect(describeCadence(habit({ id: 'b', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }))).toBe('Every day')
    expect(describeCadence(habit({ id: 'c', daysOfWeek: [1, 2, 3, 4, 5] }))).toBe('Weekdays')
    expect(describeCadence(habit({ id: 'd', daysOfWeek: [0, 6] }))).toBe('Weekends')
  })

  it('lists anything else, in week order', () => {
    expect(describeCadence(habit({ id: 'e', daysOfWeek: [5, 1] }))).toBe('Mon, Fri')
  })
})

describe('dueDaysBetween', () => {
  it('returns every day for a daily habit', () => {
    const days = dueDaysBetween(habit({ id: 'a' }), shiftDay(TODAY, -2), TODAY)
    expect(days).toHaveLength(3)
  })

  it('filters to the scheduled weekdays', () => {
    const days = dueDaysBetween(habit({ id: 'a', daysOfWeek: [4] }), shiftDay(TODAY, -7), TODAY)
    // Two Thursdays in an eight-day span.
    expect(days).toEqual([shiftDay(TODAY, -7), TODAY])
  })
})

describe('streakFor', () => {
  it('counts consecutive kept days', () => {
    const streak = streakFor(habit({ id: 'a' }), logsFor('a', lastDays(5)), TODAY)
    expect(streak.current).toBe(5)
    expect(streak.doneToday).toBe(true)
  })

  /**
   * The rule that matters: a habit due today but not yet done must not reset the
   * streak at 00:01. Today is still open, so the walk starts at yesterday.
   */
  it('does not break the streak because today is still open', () => {
    const kept = lastDays(4).slice(0, 3) // through yesterday, not today
    const streak = streakFor(habit({ id: 'a' }), logsFor('a', kept), TODAY)

    expect(streak.current).toBe(3)
    expect(streak.dueToday).toBe(true)
    expect(streak.doneToday).toBe(false)
  })

  it('breaks on a missed day in the past', () => {
    const days = lastDays(5)
    const kept = [days[0]!, days[1]!, days[3]!, days[4]!] // day index 2 missed
    const streak = streakFor(habit({ id: 'a' }), logsFor('a', kept), TODAY)
    expect(streak.current).toBe(2)
  })

  it('skips days the habit was never due on', () => {
    // Due Thursdays only; the six days between two Thursdays are not misses.
    const thursdays = habit({ id: 'a', daysOfWeek: [4] })
    const kept = [TODAY, shiftDay(TODAY, -7), shiftDay(TODAY, -14)]
    expect(streakFor(thursdays, logsFor('a', kept), TODAY).current).toBe(3)
  })

  it('remembers the longest run even after it is broken', () => {
    const days = lastDays(8)
    const kept = [days[0]!, days[1]!, days[2]!, days[3]!, days[6]!, days[7]!]
    const streak = streakFor(habit({ id: 'a' }), logsFor('a', kept), TODAY)

    expect(streak.current).toBe(2)
    expect(streak.longest).toBe(4)
  })

  it('is zero for a habit never kept', () => {
    const streak = streakFor(habit({ id: 'a' }), [], TODAY)
    expect(streak.current).toBe(0)
    expect(streak.longest).toBe(0)
    expect(streak.doneToday).toBe(false)
  })

  it('ignores logs belonging to another habit', () => {
    expect(streakFor(habit({ id: 'mine' }), logsFor('other', lastDays(5)), TODAY).current).toBe(0)
  })
})

describe('progressFor', () => {
  it('scores adherence over due days only', () => {
    // Due Thursdays; a 14-day window contains two of them, one kept.
    const progress = progressFor(
      habit({ id: 'a', daysOfWeek: [4] }),
      logsFor('a', [TODAY]),
      TODAY,
      14,
    )
    expect(progress.dueCount).toBe(2)
    expect(progress.keptCount).toBe(1)
    expect(progress.adherence).toBe(50)
  })

  it('has no adherence when nothing was due, rather than zero', () => {
    // A Monday-only habit, over a three-day window with no Monday in it.
    const progress = progressFor(habit({ id: 'a', daysOfWeek: [1] }), [], TODAY, 3)
    expect(progress.dueCount).toBe(0)
    expect(progress.adherence).toBeNull()
  })

  it('returns the window oldest first, marking due and done', () => {
    const progress = progressFor(habit({ id: 'a' }), logsFor('a', [TODAY]), TODAY, 3)
    expect(progress.recent).toHaveLength(3)
    expect(progress.recent[0]?.day).toBe(shiftDay(TODAY, -2))
    expect(progress.recent[2]).toEqual({ day: TODAY, due: true, done: true })
  })
})

describe('summarise', () => {
  it('counts what is due and kept today, and the best running streak', () => {
    const progress = [
      progressFor(habit({ id: 'a' }), logsFor('a', lastDays(5)), TODAY, 14),
      progressFor(habit({ id: 'b' }), logsFor('b', lastDays(2)), TODAY, 14),
      // Not due today: Monday only.
      progressFor(habit({ id: 'c', daysOfWeek: [1] }), [], TODAY, 14),
    ]

    const summary = summarise(progress)
    expect(summary.dueToday).toBe(2)
    expect(summary.doneToday).toBe(2)
    expect(summary.bestStreak).toBe(5)
  })

  it('reports no adherence at all with nothing due', () => {
    expect(summarise([]).adherence).toBeNull()
  })
})

describe('isValidHabitTitle', () => {
  it('rejects blank and overlong titles', () => {
    expect(isValidHabitTitle('Read')).toBe(true)
    expect(isValidHabitTitle('   ')).toBe(false)
    expect(isValidHabitTitle('x'.repeat(81))).toBe(false)
  })
})
