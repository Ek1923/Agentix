import { describe, expect, it } from 'vitest'
import {
  estimateDeltaMin,
  formatClock,
  formatDuration,
  isRunning,
  sessionDurationMs,
  totalDurationMs,
  totalMinutes,
} from './time'

const at = (iso: string) => iso

describe('sessionDurationMs', () => {
  it('measures a closed session between its own two timestamps', () => {
    const ms = sessionDurationMs(
      { startedAt: at('2026-08-27T09:00:00.000Z'), endedAt: at('2026-08-27T09:30:00.000Z') },
      at('2026-08-27T18:00:00.000Z'),
    )
    expect(ms).toBe(30 * 60_000)
  })

  it('measures a running session against the clock, not a stored counter', () => {
    const ms = sessionDurationMs(
      { startedAt: at('2026-08-27T09:00:00.000Z'), endedAt: null },
      at('2026-08-27T09:07:30.000Z'),
    )
    expect(ms).toBe(7.5 * 60_000)
  })

  it('never returns negative time when a device clock moves backwards', () => {
    const ms = sessionDurationMs(
      { startedAt: at('2026-08-27T09:00:00.000Z'), endedAt: null },
      at('2026-08-27T08:00:00.000Z'),
    )
    expect(ms).toBe(0)
  })

  it('treats an unparseable timestamp as zero rather than NaN', () => {
    expect(sessionDurationMs({ startedAt: 'not-a-date', endedAt: null }, at('2026-08-27T09:00:00.000Z'))).toBe(0)
  })
})

describe('totals', () => {
  const sessions = [
    { startedAt: '2026-08-27T09:00:00.000Z', endedAt: '2026-08-27T10:00:00.000Z' },
    { startedAt: '2026-08-27T13:00:00.000Z', endedAt: '2026-08-27T13:30:00.000Z' },
    { startedAt: '2026-08-27T15:00:00.000Z', endedAt: null },
  ]

  it('sums closed and running sessions together', () => {
    const ms = totalDurationMs(sessions, '2026-08-27T15:15:00.000Z')
    expect(ms).toBe(105 * 60_000)
    expect(totalMinutes(sessions, '2026-08-27T15:15:00.000Z')).toBe(105)
  })

  it('is zero for a task never worked on', () => {
    expect(totalDurationMs([], '2026-08-27T15:00:00.000Z')).toBe(0)
  })
})

describe('isRunning', () => {
  it('is true only when there is no end time', () => {
    expect(isRunning({ startedAt: 'x', endedAt: null })).toBe(true)
    expect(isRunning({ startedAt: 'x', endedAt: 'y' })).toBe(false)
  })
})

describe('formatDuration', () => {
  it('shows seconds only under a minute', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45_000)).toBe('45s')
  })

  it('shows whole minutes under an hour', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(45 * 60_000)).toBe('45m')
  })

  it('pads minutes past an hour so totals line up in a column', () => {
    expect(formatDuration(125 * 60_000)).toBe('2h 05m')
    expect(formatDuration(60 * 60_000)).toBe('1h 00m')
  })
})

describe('formatClock', () => {
  it('renders a running timer as a fixed-width clock', () => {
    expect(formatClock(7_000)).toBe('0:00:07')
    expect(formatClock(83 * 60_000 + 45_000)).toBe('1:23:45')
  })
})

describe('estimateDeltaMin', () => {
  it('is positive when the work ran long, negative when it ran short', () => {
    expect(estimateDeltaMin(30, 45)).toBe(15)
    expect(estimateDeltaMin(60, 40)).toBe(-20)
    expect(estimateDeltaMin(30, 30)).toBe(0)
  })

  it('returns null with no estimate, rather than scoring it as zero', () => {
    // Scoring an absent estimate as 0 would report every unestimated task as
    // massively over, and poison the accuracy numbers the backtest reads later.
    expect(estimateDeltaMin(null, 45)).toBeNull()
  })
})
