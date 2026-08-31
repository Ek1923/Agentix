import { shiftDay, type DayKey } from '../../../core/dates'
import { isActiveOn, isDueOn, isPaused } from '../../../core/habits'
import type { Habit, HabitLog } from '../../../core/db/types'

/*
  The scheduling rules moved to `core/habits.ts` when routines started appearing on
  the board: the storage layer materialises the day's tasks and cannot import from
  a plugin. They are re-exported here so this file stays the one place the plugin
  reads its own vocabulary from.
*/
export { isActiveOn, isDueOn, isPaused }

/**
 * Habit scheduling and streaks. Pure functions, no React, no Dexie — the Swift
 * build translates this file directly.
 *
 * A habit is a *rule*; a log is one occurrence of keeping it. Nothing about a
 * streak is stored, because editing the rule would make a stored streak a lie.
 */

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export function describeCadence(habit: Habit): string {
  const days = habit.daysOfWeek
  if (days.length === 0 || days.length === 7) return 'Every day'

  const sorted = [...days].sort((a, b) => a - b)
  if (sorted.join() === '1,2,3,4,5') return 'Weekdays'
  if (sorted.join() === '0,6') return 'Weekends'

  return sorted.map((d) => WEEKDAY_LABELS[d]).join(', ')
}

/** The days a habit was due across a range, oldest first. */
export function dueDaysBetween(habit: Habit, from: DayKey, to: DayKey): DayKey[] {
  const days: DayKey[] = []
  let cursor = from
  // Day keys are zero-padded, so the bound is a string comparison.
  while (cursor <= to) {
    if (isDueOn(habit, cursor)) days.push(cursor)
    cursor = shiftDay(cursor, 1)
  }
  return days
}

/** Which days a habit was actually kept, as a set for O(1) lookup. */
export function completedDays(logs: HabitLog[], habitId: string): Set<DayKey> {
  return new Set(logs.filter((log) => log.habitId === habitId).map((log) => log.day))
}

export interface Streak {
  /** Consecutive due days kept, counting back from today. */
  current: number
  longest: number
  /** True when today is a due day and it has been kept. */
  doneToday: boolean
  /** True when today is a due day at all. */
  dueToday: boolean
}

/**
 * Walks back from today over due days only.
 *
 * Today is skipped when it is still open: a habit due today and not yet done must
 * not reset a streak at 00:01. The streak breaks on the first *past* due day that
 * was missed, which is the only miss that is final.
 */
export function streakFor(
  habit: Habit,
  logs: HabitLog[],
  today: DayKey,
  lookbackDays = 365,
): Streak {
  const done = completedDays(logs, habit.id)
  const dueToday = isDueOn(habit, today)
  const doneToday = dueToday && done.has(today)

  let current = 0
  let cursor = dueToday && !doneToday ? shiftDay(today, -1) : today

  for (let step = 0; step < lookbackDays; step += 1) {
    if (isDueOn(habit, cursor)) {
      if (!done.has(cursor)) break
      current += 1
    }
    cursor = shiftDay(cursor, -1)
  }

  // The longest run needs the whole window, not just the tail.
  const from = shiftDay(today, -(lookbackDays - 1))
  let longest = 0
  let run = 0
  for (const day of dueDaysBetween(habit, from, today)) {
    if (done.has(day)) {
      run += 1
      longest = Math.max(longest, run)
    } else if (day < today || doneToday) {
      run = 0
    }
  }

  return { current, longest: Math.max(longest, current), doneToday, dueToday }
}

export interface HabitProgress {
  habit: Habit
  streak: Streak
  /** Due days kept over the recent window, as a share 0–100. Null when none were due. */
  adherence: number | null
  dueCount: number
  keptCount: number
  /** Most recent days first is wrong for a strip; this is oldest first. */
  recent: Array<{ day: DayKey; due: boolean; done: boolean }>
}

export function progressFor(
  habit: Habit,
  logs: HabitLog[],
  today: DayKey,
  windowDays: number,
): HabitProgress {
  const done = completedDays(logs, habit.id)
  const from = shiftDay(today, -(windowDays - 1))

  const recent: HabitProgress['recent'] = []
  let cursor = from
  while (cursor <= today) {
    recent.push({ day: cursor, due: isDueOn(habit, cursor), done: done.has(cursor) })
    cursor = shiftDay(cursor, 1)
  }

  const dueDays = recent.filter((entry) => entry.due)
  const kept = dueDays.filter((entry) => entry.done)

  return {
    habit,
    streak: streakFor(habit, logs, today),
    adherence: dueDays.length === 0 ? null : Math.round((kept.length / dueDays.length) * 100),
    dueCount: dueDays.length,
    keptCount: kept.length,
    recent,
  }
}

export interface HabitSummary {
  dueToday: number
  doneToday: number
  bestStreak: number
  /** Across every habit, over the window. Null when nothing was due. */
  adherence: number | null
}

export function summarise(progress: HabitProgress[]): HabitSummary {
  const due = progress.filter((p) => p.streak.dueToday)
  const totalDue = progress.reduce((sum, p) => sum + p.dueCount, 0)
  const totalKept = progress.reduce((sum, p) => sum + p.keptCount, 0)

  return {
    dueToday: due.length,
    doneToday: due.filter((p) => p.streak.doneToday).length,
    bestStreak: progress.reduce((best, p) => Math.max(best, p.streak.current), 0),
    adherence: totalDue === 0 ? null : Math.round((totalKept / totalDue) * 100),
  }
}

export function isValidHabitTitle(title: string): boolean {
  const trimmed = title.trim()
  return trimmed.length > 0 && trimmed.length <= 80
}

export function splitByPaused(habits: Habit[]): { active: Habit[]; paused: Habit[] } {
  return {
    active: habits.filter((habit) => !isPaused(habit)),
    paused: habits.filter(isPaused),
  }
}
