import { describe, expect, it } from 'vitest'
import type { Bucket, Task, TimeSession } from '../../../core/db/types'
import {
  bucketLoad,
  cycleTimeHours,
  daysSinceLastTouch,
  findStalled,
  flowMetrics,
  formatHours,
  leadTimeHours,
  STALL_DAYS,
  tasksToCsv,
  type FlowInput,
} from './flow'

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

function bucket(id: string, name: string, impliesStatus: Bucket['impliesStatus']): Bucket {
  return {
    id,
    name,
    order: 0,
    impliesStatus,
    colorId: 'slate',
    isDefault: true,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  }
}

function session(
  taskId: string,
  startedAt: string,
  endedAt: string | null,
  id = `${taskId}-s`,
): TimeSession {
  return {
    id,
    taskId,
    startedAt,
    endedAt,
    source: 'timer',
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
  }
}

const BUCKETS = [
  bucket('todo', 'To do', 'todo'),
  bucket('active', 'In progress', 'active'),
  bucket('done', 'Done', 'done'),
]

function input(overrides: Partial<FlowInput> = {}): FlowInput {
  return {
    tasks: [],
    sessions: [],
    buckets: BUCKETS,
    today: TODAY,
    nowIso: NOW,
    ...overrides,
  }
}

describe('leadTimeHours', () => {
  it('measures created to finished, including the days it sat untouched', () => {
    const hours = leadTimeHours(
      task({
        id: '1',
        createdAt: '2026-08-25T12:00:00.000Z',
        completedAt: '2026-08-27T12:00:00.000Z',
      }),
    )
    expect(hours).toBe(48)
  })

  it('is null for work that is not finished', () => {
    expect(leadTimeHours(task({ id: '1' }))).toBeNull()
  })

  it('never returns negative time when a clock moved backwards', () => {
    expect(
      leadTimeHours(
        task({
          id: '1',
          createdAt: '2026-08-27T12:00:00.000Z',
          completedAt: '2026-08-25T12:00:00.000Z',
        }),
      ),
    ).toBe(0)
  })
})

describe('cycleTimeHours', () => {
  it('measures first touch to finished, excluding the queue in front of it', () => {
    const finished = task({
      id: '1',
      createdAt: '2026-08-20T12:00:00.000Z',
      completedAt: '2026-08-27T12:00:00.000Z',
    })
    const hours = cycleTimeHours(finished, [
      session('1', '2026-08-26T12:00:00.000Z', '2026-08-26T13:00:00.000Z'),
    ])
    // Lead time would be 168 hours; the work itself waited only 24.
    expect(hours).toBe(24)
  })

  it('uses the earliest session when there are several', () => {
    const finished = task({ id: '1', completedAt: '2026-08-27T12:00:00.000Z' })
    const hours = cycleTimeHours(finished, [
      session('1', '2026-08-26T12:00:00.000Z', '2026-08-26T13:00:00.000Z', 'b'),
      session('1', '2026-08-25T12:00:00.000Z', '2026-08-25T13:00:00.000Z', 'a'),
    ])
    expect(hours).toBe(48)
  })

  it('is null when the task was finished without ever being tracked', () => {
    expect(cycleTimeHours(task({ id: '1', completedAt: NOW }), [])).toBeNull()
  })

  it('ignores sessions belonging to other tasks', () => {
    expect(
      cycleTimeHours(task({ id: 'mine', completedAt: NOW }), [
        session('other', '2026-08-20T12:00:00.000Z', null),
      ]),
    ).toBeNull()
  })
})

describe('daysSinceLastTouch', () => {
  it('counts from the most recent session', () => {
    const days = daysSinceLastTouch(
      task({ id: '1' }),
      [
        session('1', '2026-08-20T12:00:00.000Z', '2026-08-20T13:00:00.000Z', 'old'),
        session('1', '2026-08-25T12:00:00.000Z', '2026-08-25T13:00:00.000Z', 'new'),
      ],
      NOW,
    )
    // A measurement, not a label: fractional days, rounded where it is displayed.
    expect(days).toBeCloseTo(1.96, 2)
  })

  it('is null for a task never touched', () => {
    expect(daysSinceLastTouch(task({ id: '1' }), [], NOW)).toBeNull()
  })
})

describe('findStalled', () => {
  it('surfaces started work that was then left alone', () => {
    const stalled = findStalled(
      input({
        tasks: [task({ id: 'left' })],
        sessions: [session('left', '2026-08-20T12:00:00.000Z', '2026-08-20T13:00:00.000Z')],
      }),
    )
    expect(stalled).toHaveLength(1)
    expect(stalled[0]?.idleDays).toBeCloseTo(6.96, 2)
  })

  it('ignores work that was never started — planned is not stalled', () => {
    expect(findStalled(input({ tasks: [task({ id: 'never' })] }))).toEqual([])
  })

  it('ignores finished work', () => {
    expect(
      findStalled(
        input({
          tasks: [task({ id: 'done', status: 'done', completedAt: NOW })],
          sessions: [session('done', '2026-08-20T12:00:00.000Z', '2026-08-20T13:00:00.000Z')],
        }),
      ),
    ).toEqual([])
  })

  it('never calls a running timer stalled, however old the task', () => {
    expect(
      findStalled(
        input({
          tasks: [task({ id: 'running' })],
          sessions: [session('running', '2026-07-01T12:00:00.000Z', null)],
        }),
      ),
    ).toEqual([])
  })

  it('needs the idle time to cross the threshold', () => {
    const justTouched = findStalled(
      input({
        tasks: [task({ id: 'fresh' })],
        sessions: [session('fresh', '2026-08-26T12:00:00.000Z', '2026-08-26T13:00:00.000Z')],
      }),
    )
    expect(justTouched).toEqual([])
    expect(STALL_DAYS).toBe(3)
  })

  it('puts the most neglected first', () => {
    const stalled = findStalled(
      input({
        tasks: [task({ id: 'a' }), task({ id: 'b' })],
        sessions: [
          session('a', '2026-08-23T12:00:00.000Z', '2026-08-23T13:00:00.000Z'),
          session('b', '2026-08-15T12:00:00.000Z', '2026-08-15T13:00:00.000Z'),
        ],
      }),
    )
    expect(stalled.map((s) => s.task.id)).toEqual(['b', 'a'])
  })
})

describe('bucketLoad', () => {
  it('shows where open work is piled up', () => {
    const load = bucketLoad(
      input({
        tasks: [
          task({ id: '1', bucketId: 'todo' }),
          task({ id: '2', bucketId: 'todo' }),
          task({ id: '3', bucketId: 'active', status: 'active' }),
        ],
      }),
    )
    expect(load.map((l) => [l.bucket.id, l.count, l.share])).toEqual([
      ['todo', 2, 67],
      ['active', 1, 33],
    ])
  })

  it('excludes done columns, so a productive week does not read as congested', () => {
    const load = bucketLoad(
      input({ tasks: [task({ id: '1', bucketId: 'done', status: 'done' })] }),
    )
    expect(load.map((l) => l.bucket.id)).toEqual(['todo', 'active'])
    expect(load.every((l) => l.count === 0)).toBe(true)
  })

  it('reports no share rather than zero when nothing is open', () => {
    expect(bucketLoad(input()).every((l) => l.share === null)).toBe(true)
  })
})

describe('flowMetrics', () => {
  it('reports nothing measured on an empty board, rather than zeroes', () => {
    // "No data" and "measured zero" are different claims.
    const metrics = flowMetrics(input(), 30)
    expect(metrics.medianLeadHours).toBeNull()
    expect(metrics.medianCycleHours).toBeNull()
    expect(metrics.completed).toBe(0)
    expect(metrics.wip).toBe(0)
  })

  it('counts throughput per day across the window', () => {
    const tasks = Array.from({ length: 6 }, (_, i) =>
      task({
        id: `d${i}`,
        status: 'done',
        completedAt: '2026-08-26T12:00:00.000Z',
      }),
    )
    const metrics = flowMetrics(input({ tasks }), 30)
    expect(metrics.completed).toBe(6)
    expect(metrics.throughputPerDay).toBe(0.2)
  })

  it('separates work merely open from work actually in flight', () => {
    const metrics = flowMetrics(
      input({
        tasks: [task({ id: 'listed' }), task({ id: 'started' })],
        sessions: [session('started', '2026-08-26T12:00:00.000Z', '2026-08-26T13:00:00.000Z')],
      }),
      30,
    )
    expect(metrics.wip).toBe(2)
    expect(metrics.started).toBe(1)
  })

  it('takes the median lead time, so one bad week does not define the number', () => {
    const tasks = [
      task({ id: 'a', status: 'done', createdAt: '2026-08-26T12:00:00.000Z', completedAt: '2026-08-26T13:00:00.000Z' }),
      task({ id: 'b', status: 'done', createdAt: '2026-08-26T12:00:00.000Z', completedAt: '2026-08-26T14:00:00.000Z' }),
      task({ id: 'outlier', status: 'done', createdAt: '2026-07-01T12:00:00.000Z', completedAt: '2026-08-26T12:00:00.000Z' }),
    ]
    // A mean would be dragged past 300 hours by the outlier.
    expect(flowMetrics(input({ tasks }), 30).medianLeadHours).toBe(2)
  })
})

describe('formatHours', () => {
  it('reads minutes, hours, then days', () => {
    expect(formatHours(0.5)).toBe('30m')
    expect(formatHours(6)).toBe('6h')
    expect(formatHours(60)).toBe('2.5d')
  })

  it('shows a dash for nothing measured, never a zero', () => {
    expect(formatHours(null)).toBe('—')
  })
})

describe('tasksToCsv', () => {
  it('writes a header and a row per task', () => {
    const csv = tasksToCsv(input({ tasks: [task({ id: '1', title: 'Ship it' })] }))
    const [header, row] = csv.split('\n')

    expect(header).toContain('id,title,status,bucket')
    expect(row).toContain('Ship it')
    expect(row).toContain('To do')
  })

  it('quotes fields containing commas, quotes or newlines', () => {
    const csv = tasksToCsv(input({ tasks: [task({ id: '1', title: 'Ship, then "test"' })] }))
    expect(csv).toContain('"Ship, then ""test"""')
  })

  it('defuses a title a spreadsheet would run as a formula', () => {
    // `=1+1` in a cell executes on open; the leading quote makes it text.
    const csv = tasksToCsv(input({ tasks: [task({ id: '1', title: '=1+1' })] }))
    expect(csv).toContain("'=1+1")
    expect(csv).not.toMatch(/,=1\+1/)
  })

  it('includes tracked minutes and both timings', () => {
    const csv = tasksToCsv(
      input({
        tasks: [
          task({
            id: '1',
            status: 'done',
            createdAt: '2026-08-26T12:00:00.000Z',
            completedAt: '2026-08-27T12:00:00.000Z',
          }),
        ],
        sessions: [session('1', '2026-08-27T10:00:00.000Z', '2026-08-27T11:00:00.000Z')],
      }),
    )
    const row = csv.split('\n')[1] ?? ''
    expect(row).toContain('60') // tracked minutes
    expect(row).toContain('24') // lead time hours
  })

  it('leaves an unmeasured field empty rather than writing a zero', () => {
    const csv = tasksToCsv(input({ tasks: [task({ id: '1' })] }))
    const row = csv.split('\n')[1] ?? ''
    expect(row.endsWith(',,')).toBe(true)
  })
})
