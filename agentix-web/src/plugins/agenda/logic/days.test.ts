import { describe, expect, it } from 'vitest'
import {
  dayLabel,
  dayOfMonth,
  isPast,
  isToday,
  isWeekend,
  monthLabel,
  parseDayKey,
  shiftDay,
  todayKey,
  weekOf,
  weekdayShort,
} from './days'

describe('todayKey', () => {
  it('is a local calendar date, never a UTC instant', () => {
    // 23:30 local on the 27th is the 28th in UTC. Using the UTC date here would
    // move every task created late in the evening onto tomorrow.
    const lateEvening = new Date(2026, 7, 27, 23, 30)
    expect(todayKey(lateEvening)).toBe('2026-08-27')
  })

  it('handles early morning the same way', () => {
    const earlyMorning = new Date(2026, 7, 27, 0, 30)
    expect(todayKey(earlyMorning)).toBe('2026-08-27')
  })

  it('produces the shape Task.plannedFor uses', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('shiftDay', () => {
  it('moves forward and back', () => {
    expect(shiftDay('2026-08-27', 1)).toBe('2026-08-28')
    expect(shiftDay('2026-08-27', -1)).toBe('2026-08-26')
    expect(shiftDay('2026-08-27', 0)).toBe('2026-08-27')
  })

  it('crosses month and year boundaries', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01')
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('handles a leap day', () => {
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29')
    expect(shiftDay('2028-02-29', 1)).toBe('2028-03-01')
  })

  it('shifts a whole week for the strip controls', () => {
    expect(shiftDay('2026-08-27', 7)).toBe('2026-09-03')
    expect(shiftDay('2026-08-27', -7)).toBe('2026-08-20')
  })
})

describe('weekOf', () => {
  it('returns seven days starting on Monday', () => {
    // 2026-08-27 is a Thursday.
    const week = weekOf('2026-08-27')
    expect(week).toHaveLength(7)
    expect(week[0]).toBe('2026-08-24')
    expect(week[6]).toBe('2026-08-30')
    expect(week).toContain('2026-08-27')
  })

  it('gives the same week for any day inside it', () => {
    expect(weekOf('2026-08-24')).toEqual(weekOf('2026-08-30'))
  })

  it('handles a week spanning two months', () => {
    const week = weekOf('2026-08-31')
    expect(week[0]).toBe('2026-08-31')
    expect(week[6]).toBe('2026-09-06')
  })
})

describe('dayLabel', () => {
  const today = '2026-08-27'

  it('names the three days people think in', () => {
    expect(dayLabel(today, today)).toBe('Today')
    expect(dayLabel('2026-08-28', today)).toBe('Tomorrow')
    expect(dayLabel('2026-08-26', today)).toBe('Yesterday')
  })

  it('gives a real date for anything else', () => {
    expect(dayLabel('2026-08-31', today)).toBe('Monday, 31 August')
  })
})

describe('day predicates', () => {
  const today = '2026-08-27'

  it('knows today from any other day', () => {
    expect(isToday(today, today)).toBe(true)
    expect(isToday('2026-08-28', today)).toBe(false)
  })

  it('knows a past day, and does not count today as past', () => {
    expect(isPast('2026-08-26', today)).toBe(true)
    expect(isPast(today, today)).toBe(false)
    expect(isPast('2026-08-28', today)).toBe(false)
  })

  it('compares correctly across a year boundary, because keys sort lexically', () => {
    expect(isPast('2025-12-31', '2026-01-01')).toBe(true)
    expect(isPast('2026-01-02', '2026-01-01')).toBe(false)
  })

  it('identifies weekends', () => {
    expect(isWeekend('2026-08-29')).toBe(true) // Saturday
    expect(isWeekend('2026-08-30')).toBe(true) // Sunday
    expect(isWeekend('2026-08-27')).toBe(false) // Thursday
  })
})

describe('display helpers', () => {
  it('formats the strip and header', () => {
    expect(weekdayShort('2026-08-27')).toBe('Thu')
    expect(dayOfMonth('2026-08-27')).toBe('27')
    expect(monthLabel('2026-08-27')).toBe('August 2026')
  })
})

describe('parseDayKey', () => {
  it('parses at local midnight, not UTC midnight', () => {
    const parsed = parseDayKey('2026-08-27')
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(7)
    expect(parsed.getDate()).toBe(27)
    expect(parsed.getHours()).toBe(0)
  })

  it('falls back rather than producing an Invalid Date', () => {
    const fallback = new Date(2026, 7, 27)
    expect(parseDayKey('not-a-day', fallback)).toEqual(fallback)
  })
})
