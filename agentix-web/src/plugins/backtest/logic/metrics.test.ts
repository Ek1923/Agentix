import { describe, expect, it } from 'vitest'
import type { Task, TimeSession } from '../../../core/db/types'
import {
  ACCURACY_TOLERANCE,
  buildDays,
  clockLabel,
  describeRatio,
  DEFAULT_WINDOW,
  formatMinutes,
  formatMinutesOfDay,
  formatPercent,
  minutesIntoDay,
  scoreEstimates,
  summarise,
  summariseAccuracy,
  verdictFor,
  windowDays,
  WINDOWS,
} from './metrics'

const TODAY = '2026-08-27'
const NOW = '2026-08-27T23:00:00.000Z'

function task(overrides: Partial<Task> & { id: string }): Task {
  const base: Task = {
    id: overrides.id,
    title: overrides.id,
    notes: null,
    link: null,
    status: 'todo',
    bucketId: 'todo',
    assigneeIds: [],
    plannedFor: TODAY,
    estimateMin: null,
    completedAt: null,
    priority: 0,
    tags: [],
    habitId: null,
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:00:00.000Z',
    deletedAt: null,
  }
  return Object.assign(base, overrides)
}

/** A closed session on a local day, starting at `hour` and running `minutes`. */
function session(
  taskId: string,
  day: string,
  hour: number,
  minutes: number,
  id = `${taskId}-${day}-${hour}`,
): TimeSession {
  const start = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`)
  return {
    id,
    taskId,
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    source: 'timer',
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
  }
}

describe('windowDays', () => {
  it('returns exactly N days, ending today, oldest first', () => {
    const days = windowDays(TODAY, 5)
    expect(days).toHaveLength(5)
    expect(days[0]).toBe('2026-08-23')
    expect(days[4]).toBe(TODAY)
  })

  it('offers the five windows the brief specifies, defaulting to ten', () => {
    expect(WINDOWS).toEqual([5, 10, 15, 20, 30])
    expect(DEFAULT_WINDOW).toBe(10)
  })

  it('crosses a month boundary', () => {
    expect(windowDays('2026-09-02', 5)[0]).toBe('2026-08-29')
  })
})

describe('buildDays', () => {
  it('reports an untouched day as empty, never as zero', () => {
    // A flat line at zero reads as failure; this day simply has nothing to say.
    const [day] = buildDays([], [], ['2026-08-25'], NOW)
    expect(day?.hasData).toBe(false)
    expect(day?.completionRate).toBeNull()
    expect(day?.focusMinutes).toBeNull()
    expect(day?.longestSessionMin).toBeNull()
  })

  it('computes completion rate from what was planned that day', () => {
    const days = buildDays(
      [
        task({ id: 'a', plannedFor: '2026-08-25', status: 'done' }),
        task({ id: 'b', plannedFor: '2026-08-25', status: 'done' }),
        task({ id: 'c', plannedFor: '2026-08-25' }),
      ],
      [],
      ['2026-08-25'],
      NOW,
    )
    expect(days[0]?.planned).toBe(3)
    expect(days[0]?.done).toBe(2)
    expect(days[0]?.completionRate).toBe(67)
  })

  it('sums focus time from every session that day', () => {
    const days = buildDays(
      [],
      [session('a', '2026-08-25', 9, 60, 'x'), session('a', '2026-08-25', 14, 45, 'y')],
      ['2026-08-25'],
      NOW,
    )
    expect(days[0]?.focusMinutes).toBe(105)
    expect(days[0]?.hasData).toBe(true)
  })

  it('records the first clock-in and last clock-out of the day', () => {
    const days = buildDays(
      [],
      [session('a', '2026-08-25', 14, 30, 'pm'), session('a', '2026-08-25', 9, 30, 'am')],
      ['2026-08-25'],
      NOW,
    )
    expect(clockLabel(days[0]?.firstClockIn ?? null)).toBe('09:00')
    expect(clockLabel(days[0]?.lastClockOut ?? null)).toBe('14:30')
  })

  it('finds the longest unbroken session', () => {
    const days = buildDays(
      [],
      [session('a', '2026-08-25', 9, 25, 'short'), session('a', '2026-08-25', 13, 95, 'long')],
      ['2026-08-25'],
      NOW,
    )
    expect(days[0]?.longestSessionMin).toBe(95)
  })

  it('attributes a session to the local day it started, not the UTC one', () => {
    // 23:30 local is already tomorrow in UTC; counting it there would move a
    // late evening onto the next morning.
    const lateNight = session('a', '2026-08-25', 23, 30)
    const days = buildDays([], [lateNight], ['2026-08-25', '2026-08-26'], NOW)

    expect(days[0]?.focusMinutes).toBe(30)
    expect(days[1]?.focusMinutes).toBeNull()
  })

  it('keeps a day planned but not worked as planned, with no focus time', () => {
    const days = buildDays([task({ id: 'a', plannedFor: '2026-08-25' })], [], ['2026-08-25'], NOW)
    expect(days[0]?.hasData).toBe(true)
    expect(days[0]?.completionRate).toBe(0)
    expect(days[0]?.focusMinutes).toBeNull()
  })

  it('returns one entry per requested day, in order', () => {
    const days = buildDays([], [], windowDays(TODAY, 5), NOW)
    expect(days.map((d) => d.day)).toEqual(windowDays(TODAY, 5))
  })
})

describe('verdictFor', () => {
  it('calls anything within tolerance accurate', () => {
    expect(verdictFor(1)).toBe('accurate')
    expect(verdictFor(1 + ACCURACY_TOLERANCE)).toBe('accurate')
    expect(verdictFor(1 - ACCURACY_TOLERANCE)).toBe('accurate')
  })

  it('calls a real overrun over and a real saving under', () => {
    expect(verdictFor(1.5)).toBe('over')
    expect(verdictFor(0.5)).toBe('under')
  })
})

describe('scoreEstimates', () => {
  it('scores a finished task against its estimate', () => {
    const [scored] = scoreEstimates(
      [task({ id: 'a', status: 'done', estimateMin: 60 })],
      [session('a', '2026-08-25', 9, 90)],
      NOW,
    )
    expect(scored?.actualMin).toBe(90)
    expect(scored?.deltaMin).toBe(30)
    expect(scored?.ratio).toBe(1.5)
    expect(scored?.verdict).toBe('over')
  })

  it('skips a task with no estimate rather than scoring it as zero', () => {
    // Scoring an unestimated task would invent accuracy the data does not contain.
    expect(
      scoreEstimates([task({ id: 'a', status: 'done' })], [session('a', '2026-08-25', 9, 60)], NOW),
    ).toEqual([])
  })

  it('skips a finished task that was never tracked', () => {
    expect(scoreEstimates([task({ id: 'a', status: 'done', estimateMin: 60 })], [], NOW)).toEqual([])
  })

  it('skips unfinished work, however much was tracked', () => {
    expect(
      scoreEstimates(
        [task({ id: 'a', estimateMin: 60 })],
        [session('a', '2026-08-25', 9, 200)],
        NOW,
      ),
    ).toEqual([])
  })

  it('sums several sessions into one actual', () => {
    const [scored] = scoreEstimates(
      [task({ id: 'a', status: 'done', estimateMin: 60 })],
      [session('a', '2026-08-25', 9, 30, 'x'), session('a', '2026-08-26', 9, 30, 'y')],
      NOW,
    )
    expect(scored?.actualMin).toBe(60)
    expect(scored?.verdict).toBe('accurate')
  })
})

describe('summariseAccuracy', () => {
  it('counts each verdict and reports the median', () => {
    const tasks = [
      task({ id: 'over', status: 'done', estimateMin: 60 }),
      task({ id: 'under', status: 'done', estimateMin: 60 }),
      task({ id: 'right', status: 'done', estimateMin: 60 }),
    ]
    const sessions = [
      session('over', '2026-08-25', 9, 120),
      session('under', '2026-08-25', 9, 30),
      session('right', '2026-08-25', 9, 60),
    ]

    const accuracy = summariseAccuracy(tasks, sessions, NOW)
    expect([accuracy.under, accuracy.accurate, accuracy.over]).toEqual([1, 1, 1])
    expect(accuracy.medianRatio).toBe(1)
    expect(accuracy.medianDeltaMin).toBe(0)
  })

  it('reports how many finished tasks could not be scored', () => {
    const accuracy = summariseAccuracy(
      [
        task({ id: 'scored', status: 'done', estimateMin: 60 }),
        task({ id: 'no-estimate', status: 'done' }),
        task({ id: 'never-tracked', status: 'done', estimateMin: 30 }),
      ],
      [session('scored', '2026-08-25', 9, 60)],
      NOW,
    )
    expect(accuracy.scored).toHaveLength(1)
    expect(accuracy.unscorable).toBe(2)
  })

  it('has no median at all with nothing to score', () => {
    const accuracy = summariseAccuracy([], [], NOW)
    expect(accuracy.medianRatio).toBeNull()
    expect(accuracy.medianDeltaMin).toBeNull()
  })
})

describe('summarise', () => {
  it('rolls the window up without inventing anything', () => {
    const days = windowDays(TODAY, 5)
    const summary = summarise(
      [
        task({ id: 'a', plannedFor: '2026-08-25', status: 'done', estimateMin: 60 }),
        task({ id: 'b', plannedFor: '2026-08-25' }),
      ],
      [session('a', '2026-08-25', 9, 90)],
      days,
      NOW,
    )

    expect(summary.totalPlanned).toBe(2)
    expect(summary.totalDone).toBe(1)
    expect(summary.completionRate).toBe(50)
    expect(summary.totalFocusMinutes).toBe(90)
    expect(summary.activeDays).toBe(1)
    expect(summary.longestSessionMin).toBe(90)
    expect(summary.earliestClockIn).toBe('09:00')
    expect(summary.latestClockOut).toBe('10:30')
  })

  it('excludes untracked days from the typical focus figure', () => {
    // Counting empty days as zero would halve a real median.
    const summary = summarise(
      [],
      [session('a', '2026-08-25', 9, 120), session('a', '2026-08-27', 9, 60)],
      windowDays(TODAY, 5),
      NOW,
    )
    expect(summary.medianFocusMinutes).toBe(90)
    expect(summary.activeDays).toBe(2)
  })

  it('knows nothing from an empty window, and says so with nulls', () => {
    const summary = summarise([], [], windowDays(TODAY, 10), NOW)
    expect(summary.completionRate).toBeNull()
    expect(summary.medianFocusMinutes).toBeNull()
    expect(summary.longestSessionMin).toBeNull()
    expect(summary.earliestClockIn).toBeNull()
    expect(summary.activeDays).toBe(0)
  })

  it('gives the same answer for a day whichever window contains it', () => {
    // Switching the window must re-slice, never re-measure differently.
    const tasks = [task({ id: 'a', plannedFor: '2026-08-25', status: 'done' })]
    const sessions = [session('a', '2026-08-25', 9, 45)]

    const short = summarise(tasks, sessions, windowDays(TODAY, 5), NOW)
    const long = summarise(tasks, sessions, windowDays(TODAY, 30), NOW)

    expect(short.totalFocusMinutes).toBe(long.totalFocusMinutes)
    expect(short.completionRate).toBe(long.completionRate)
    expect(short.days).toHaveLength(5)
    expect(long.days).toHaveLength(30)
  })
})

describe('formatting', () => {
  it('shows a dash for nothing measured, never a zero', () => {
    expect(formatMinutes(null)).toBe('—')
    expect(formatPercent(null)).toBe('—')
  })

  it('reads minutes below an hour and hours above', () => {
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(150)).toBe('2h 30m')
    expect(formatMinutes(120)).toBe('2h')
  })

  it('places a clock time on the day', () => {
    expect(formatMinutesOfDay(9 * 60 + 5)).toBe('09:05')
    expect(minutesIntoDay(new Date('2026-08-25T09:30:00').toISOString())).toBe(570)
  })

  it('describes the median ratio in words', () => {
    expect(describeRatio(1)).toBe('Estimates are about right.')
    expect(describeRatio(1.5)).toBe('Work takes about 50% longer than estimated.')
    expect(describeRatio(0.6)).toBe('Work takes about 40% less than estimated.')
    expect(describeRatio(null)).toBeNull()
  })
})
