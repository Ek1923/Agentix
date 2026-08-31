import { addDays, format, isValid, parseISO, startOfWeek } from 'date-fns'

/**
 * Calendar-day arithmetic. Pure functions, no React, no Dexie — the Swift build
 * translates this file directly.
 *
 * Lives in core rather than in a plugin: Agenda, Reconsider and Backtest all need
 * the same day maths, and three copies would drift.
 *
 * Everything here works on `'YYYY-MM-DD'` strings, the same shape `Task.plannedFor`
 * uses. That is deliberate: "which day is this task on" is a local question, and
 * converting to a UTC instant on the way in and out is how tasks end up jumping a
 * day for anyone east or west of the machine that wrote them.
 */

export type DayKey = string // 'YYYY-MM-DD'

/** Today, as the local calendar sees it. */
export function todayKey(now: Date = new Date()): DayKey {
  return format(now, 'yyyy-MM-dd')
}

/** Parses a day key at local midnight. Invalid input falls back to today. */
export function parseDayKey(key: DayKey, now: Date = new Date()): Date {
  const parsed = parseISO(key)
  return isValid(parsed) ? parsed : now
}

export function shiftDay(key: DayKey, delta: number): DayKey {
  return format(addDays(parseDayKey(key), delta), 'yyyy-MM-dd')
}

/**
 * The seven days of the week containing `key`.
 *
 * Which day a week opens on is regional, not a detail: a Dutch week that starts
 * on Sunday reads as broken, and so does an American one that starts on Monday.
 * The caller passes the preference rather than this file guessing.
 */
export function weekOf(key: DayKey, weekStartsOn: 0 | 1 = 1): DayKey[] {
  const first = startOfWeek(parseDayKey(key), { weekStartsOn })
  return Array.from({ length: 7 }, (_, i) => format(addDays(first, i), 'yyyy-MM-dd'))
}

/**
 * How a day is named in the header. Relative names beat dates for the three days
 * people actually think in; everything else gets a real date.
 */
export function dayLabel(key: DayKey, today: DayKey = todayKey()): string {
  if (key === today) return 'Today'
  if (key === shiftDay(today, 1)) return 'Tomorrow'
  if (key === shiftDay(today, -1)) return 'Yesterday'
  return format(parseDayKey(key), 'EEEE, d MMMM')
}

/** Short forms for the week strip: "Mon", "27". */
export function weekdayShort(key: DayKey): string {
  return format(parseDayKey(key), 'EEE')
}

export function dayOfMonth(key: DayKey): string {
  return format(parseDayKey(key), 'd')
}

export function monthLabel(key: DayKey): string {
  return format(parseDayKey(key), 'MMMM yyyy')
}

export function isToday(key: DayKey, today: DayKey = todayKey()): boolean {
  return key === today
}

/** Strictly before today — used to mark days whose open tasks are now missed. */
export function isPast(key: DayKey, today: DayKey = todayKey()): boolean {
  return key < today
}

export function isWeekend(key: DayKey): boolean {
  const day = parseDayKey(key).getDay()
  return day === 0 || day === 6
}

/**
 * The local calendar day an instant falls on.
 *
 * Local, not UTC: work tracked at 23:30 belongs to that evening, not to the next
 * morning. Getting this wrong shifts every per-day figure by a day for anyone
 * working late.
 */
export function localDayOf(iso: string): DayKey {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return todayKey()
  return format(at, 'yyyy-MM-dd')
}
