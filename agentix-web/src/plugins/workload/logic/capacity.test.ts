import { describe, expect, it } from 'vitest'
import type { Person, Task, TimeSession } from '../../../core/db/types'
import {
  formatMinutes,
  isOvercommitted,
  loadByPerson,
  measureCapacity,
  MIN_DAYS_FOR_CAPACITY,
  MIN_TRACKED_MINUTES,
  planAhead,
  sessionDay,
  summarise,
  trackedMinutesByDay,
  type Capacity,
} from './capacity'

const TODAY = '2026-08-27'
const NOW = '2026-08-27T12:00:00.000Z'

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

/** A session of `minutes` on a given local day, at midday to avoid edge effects. */
function session(day: string, minutes: number, id = `${day}-${minutes}`): TimeSession {
  const start = new Date(`${day}T12:00:00`)
  return {
    id,
    taskId: 'any',
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    source: 'timer',
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
  }
}

function person(id: string, name = id): Person {
  return {
    id,
    name,
    colorId: 'ocean',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  }
}

const NO_CAPACITY: Capacity = { medianMinutes: null, measuredDays: 0, bestMinutes: null }
const KNOWN_CAPACITY: Capacity = { medianMinutes: 240, measuredDays: 5, bestMinutes: 400 }

describe('sessionDay', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // 23:30 local is already tomorrow in UTC; attributing work to the wrong day
    // would shift every capacity figure.
    const lateEvening = new Date(2026, 7, 27, 23, 30)
    expect(
      sessionDay({
        ...session('2026-08-27', 30),
        startedAt: lateEvening.toISOString(),
      }),
    ).toBe('2026-08-27')
  })
})

describe('trackedMinutesByDay', () => {
  it('sums every session on a day', () => {
    const byDay = trackedMinutesByDay(
      [session('2026-08-25', 60, 'a'), session('2026-08-25', 30, 'b')],
      NOW,
    )
    expect(byDay.get('2026-08-25')).toBe(90)
  })

  it('leaves untracked days out rather than counting them as zero', () => {
    // A weekend is an absence of evidence, not evidence of no capacity.
    const byDay = trackedMinutesByDay([session('2026-08-25', 60)], NOW)
    expect(byDay.size).toBe(1)
    expect(byDay.has('2026-08-26')).toBe(false)
  })

  it('discards a day that is only a stray click', () => {
    const byDay = trackedMinutesByDay([session('2026-08-25', MIN_TRACKED_MINUTES - 1)], NOW)
    expect(byDay.size).toBe(0)
  })
})

describe('measureCapacity', () => {
  it('refuses to guess until enough days are measured', () => {
    const capacity = measureCapacity([session('2026-08-25', 120)], NOW)
    expect(capacity.medianMinutes).toBeNull()
    expect(capacity.measuredDays).toBe(1)
  })

  it('reports a median once there is enough evidence', () => {
    const sessions = [
      session('2026-08-24', 120),
      session('2026-08-25', 240),
      session('2026-08-26', 180),
    ]
    const capacity = measureCapacity(sessions, NOW)

    expect(capacity.measuredDays).toBe(MIN_DAYS_FOR_CAPACITY)
    expect(capacity.medianMinutes).toBe(180)
    expect(capacity.bestMinutes).toBe(240)
  })

  it('takes the median, so one heroic day does not become the expectation', () => {
    const sessions = [
      session('2026-08-22', 120),
      session('2026-08-23', 120),
      session('2026-08-24', 120),
      session('2026-08-25', 600),
    ]
    // A mean would claim 240 minutes a day; no such day has happened four times.
    expect(measureCapacity(sessions, NOW).medianMinutes).toBe(120)
  })

  it('knows nothing from nothing', () => {
    expect(measureCapacity([], NOW)).toEqual({
      medianMinutes: null,
      measuredDays: 0,
      bestMinutes: null,
    })
  })
})

describe('planAhead', () => {
  it('returns one entry per day, starting today', () => {
    const plans = planAhead([], TODAY, 3, NO_CAPACITY)
    expect(plans.map((p) => p.day)).toEqual(['2026-08-27', '2026-08-28', '2026-08-29'])
  })

  it('sums estimates onto the day they are planned for', () => {
    const plans = planAhead(
      [
        task({ id: 'a', estimateMin: 60 }),
        task({ id: 'b', estimateMin: 30 }),
        task({ id: 'c', plannedFor: '2026-08-28', estimateMin: 45 }),
      ],
      TODAY,
      2,
      NO_CAPACITY,
    )
    expect(plans[0]?.plannedMinutes).toBe(90)
    expect(plans[1]?.plannedMinutes).toBe(45)
  })

  it('counts work that carries no estimate rather than hiding it', () => {
    // What cannot be weighed still has to be flagged, or the plan looks lighter
    // than it is.
    const plans = planAhead([task({ id: 'a' }), task({ id: 'b', estimateMin: 60 })], TODAY, 1, NO_CAPACITY)
    expect(plans[0]?.plannedMinutes).toBe(60)
    expect(plans[0]?.unestimated).toBe(1)
  })

  it('excludes finished work, which is no longer load', () => {
    const plans = planAhead(
      [task({ id: 'done', status: 'done', estimateMin: 120 })],
      TODAY,
      1,
      NO_CAPACITY,
    )
    expect(plans[0]?.plannedMinutes).toBe(0)
    expect(plans[0]?.tasks).toEqual([])
  })

  it('keeps an empty day, so free room is visible', () => {
    const plans = planAhead([], TODAY, 2, NO_CAPACITY)
    expect(plans).toHaveLength(2)
    expect(plans[1]?.tasks).toEqual([])
  })

  it('has no load percentage while capacity is unknown', () => {
    const plans = planAhead([task({ id: 'a', estimateMin: 300 })], TODAY, 1, NO_CAPACITY)
    expect(plans[0]?.loadPercent).toBeNull()
    expect(isOvercommitted(plans[0]!)).toBe(false)
  })

  it('measures load against proven capacity once it is known', () => {
    const plans = planAhead([task({ id: 'a', estimateMin: 120 })], TODAY, 1, KNOWN_CAPACITY)
    expect(plans[0]?.loadPercent).toBe(50)
    expect(isOvercommitted(plans[0]!)).toBe(false)
  })

  it('flags a day planned beyond what a typical day has held', () => {
    const plans = planAhead([task({ id: 'a', estimateMin: 360 })], TODAY, 1, KNOWN_CAPACITY)
    expect(plans[0]?.loadPercent).toBe(150)
    expect(isOvercommitted(plans[0]!)).toBe(true)
  })
})

describe('loadByPerson', () => {
  const alice = person('p1', 'Alice')
  const bob = person('p2', 'Bob')

  it('reports what is on each person plate', () => {
    const plans = planAhead(
      [
        task({ id: 'a', estimateMin: 60, assigneeIds: ['p1'] }),
        task({ id: 'b', estimateMin: 30, assigneeIds: ['p1'] }),
        task({ id: 'c', estimateMin: 90, assigneeIds: ['p2'] }),
      ],
      TODAY,
      1,
      NO_CAPACITY,
    )

    const loads = loadByPerson(plans, [alice, bob])
    // Equal minutes, so the one split across more tasks leads: same time, more
    // switching.
    expect(loads.map((l) => [l.person.name, l.taskCount, l.plannedMinutes])).toEqual([
      ['Alice', 2, 90],
      ['Bob', 1, 90],
    ])
  })

  it('counts a shared task for everyone tagged on it', () => {
    const plans = planAhead(
      [task({ id: 'shared', estimateMin: 60, assigneeIds: ['p1', 'p2'] })],
      TODAY,
      1,
      NO_CAPACITY,
    )
    const loads = loadByPerson(plans, [alice, bob])
    expect(loads).toHaveLength(2)
    expect(loads.every((l) => l.plannedMinutes === 60)).toBe(true)
  })

  it('leaves out people with nothing assigned', () => {
    const plans = planAhead([task({ id: 'a', assigneeIds: ['p1'] })], TODAY, 1, NO_CAPACITY)
    expect(loadByPerson(plans, [alice, bob]).map((l) => l.person.id)).toEqual(['p1'])
  })
})

describe('summarise', () => {
  it('totals the days ahead', () => {
    const plans = planAhead(
      [
        task({ id: 'a', estimateMin: 360 }),
        task({ id: 'b', plannedFor: '2026-08-28' }),
      ],
      TODAY,
      3,
      KNOWN_CAPACITY,
    )

    expect(summarise(plans)).toEqual({
      plannedMinutes: 360,
      unestimated: 1,
      overcommittedDays: 1,
      freeDays: 1,
    })
  })

  it('is all zeroes for an empty plan, and every day counts as free', () => {
    expect(summarise(planAhead([], TODAY, 5, NO_CAPACITY))).toEqual({
      plannedMinutes: 0,
      unestimated: 0,
      overcommittedDays: 0,
      freeDays: 5,
    })
  })
})

describe('formatMinutes', () => {
  it('reads minutes below an hour and hours above', () => {
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(60)).toBe('1h')
    expect(formatMinutes(150)).toBe('2h 30m')
  })

  it('shows a dash for nothing measured, never a zero', () => {
    expect(formatMinutes(null)).toBe('—')
  })
})
