import { parseDayKey, type DayKey } from './dates'
import type { Habit } from './db/types'

/**
 * What a routine *is*, and what it becomes on a given day.
 *
 * Pure, no React, no Dexie — the Swift build translates this file directly, and it
 * has to, because two devices materialising the same routine must arrive at
 * byte-identical rows or sync would show the same chore twice.
 *
 * A habit stays a rule. What this adds is the day's instance of that rule: the
 * task the routine becomes so it can sit alongside the rest of the day's work
 * instead of hiding in its own plugin.
 */

/* ── The rule ───────────────────────────────────────────────────────────────── */

/**
 * A paused routine.
 *
 * Pausing exists because deleting a routine you are stepping away from throws its
 * whole history away, and a streak you rebuilt from zero is not the same fact as
 * a streak you resumed.
 */
export function isPaused(habit: Habit): boolean {
  return habit.archivedAt !== null
}

/** Empty `daysOfWeek` means every day — the common case, stored as no constraint. */
export function isDueOn(habit: Habit, day: DayKey): boolean {
  if (habit.daysOfWeek.length === 0) return true
  return habit.daysOfWeek.includes(parseDayKey(day).getDay())
}

/** A paused routine is never due, so it neither breaks a streak nor counts today. */
export function isActiveOn(habit: Habit, day: DayKey): boolean {
  return !isPaused(habit) && isDueOn(habit, day)
}

/* ── The day's instance ─────────────────────────────────────────────────────── */

/**
 * The id a routine's task takes on a day.
 *
 * Derived rather than random, which is the one deliberate exception to "ids are
 * `crypto.randomUUID()`". Two devices that both open the app on Tuesday each
 * generate Tuesday's card; with random ids that is two cards for one chore,
 * forever, because sync has no way to know they mean the same thing. Derived, the
 * second device writes the row the first one already wrote, and last-write-wins
 * resolves it into one.
 *
 * The shape is `habit:<habitId>:<day>`. A habit id is a uuid and a day key is
 * `YYYY-MM-DD`; neither contains a colon, so the split back is unambiguous.
 */
export const HABIT_TASK_PREFIX = 'habit:'

export function habitTaskId(habitId: string, day: DayKey): string {
  return `${HABIT_TASK_PREFIX}${habitId}:${day}`
}

export function isHabitTaskId(id: string): boolean {
  return parseHabitTaskId(id) !== null
}

/** The routine and day an id came from, or `null` if it is an ordinary task. */
export function parseHabitTaskId(id: string): { habitId: string; day: DayKey } | null {
  if (!id.startsWith(HABIT_TASK_PREFIX)) return null

  const [, habitId, day, ...rest] = id.split(':')
  if (rest.length > 0) return null
  if (habitId === undefined || habitId === '') return null
  if (day === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null

  return { habitId, day }
}

/** One routine, as the day's work. */
export interface PlannedRoutine {
  taskId: string
  habitId: string
  day: DayKey
  title: string
  estimateMin: number | null
}

/**
 * Everything due on a day, in the order the routines were created.
 *
 * Paused routines are absent, not present-and-skipped: a card for something you
 * deliberately stepped away from is exactly the noise pausing is for avoiding.
 */
export function routinesFor(habits: Habit[], day: DayKey): PlannedRoutine[] {
  return habits
    .filter((habit) => isActiveOn(habit, day))
    .map((habit) => ({
      taskId: habitTaskId(habit.id, day),
      habitId: habit.id,
      day,
      title: habit.title,
      estimateMin: habit.estimateMin,
    }))
}
