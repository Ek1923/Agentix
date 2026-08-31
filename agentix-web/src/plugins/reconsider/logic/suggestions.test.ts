import { describe, expect, it } from 'vitest'
import type { Task, TimeSession } from '../../../core/db/types'
import {
  buildSuggestions,
  countSuggestions,
  daysBetween,
  isOverdue,
  KIND_LABELS,
  MEANINGFUL_MINUTES,
  reasonFor,
  STALE_DAYS,
  tomorrowOf,
} from './suggestions'

const TODAY = '2026-08-27'
const NOW = '2026-08-27T12:00:00.000Z'

function task(overrides: Partial<Task> & { id: string }): Task {
  const base: Task = {
    id: overrides.id,
    title: overrides.id,
    notes: null,
    link: null,
    status: 'todo',
    bucketId: 'bucket-todo',
    assigneeIds: [],
    plannedFor: TODAY,
    estimateMin: null,
    completedAt: null,
    priority: 0,
    tags: [],
    habitId: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    deletedAt: null,
  }
  return Object.assign(base, overrides)
}

/** A closed session of a given length, attributed to a task. */
function session(taskId: string, minutes: number, id = `${taskId}-s`): TimeSession {
  const start = Date.parse('2026-08-20T09:00:00.000Z')
  return {
    id,
    taskId,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + minutes * 60_000).toISOString(),
    source: 'timer',
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:00:00.000Z',
    deletedAt: null,
  }
}

describe('daysBetween', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-08-20', '2026-08-27')).toBe(7)
    expect(daysBetween('2026-08-27', '2026-08-27')).toBe(0)
  })

  it('crosses months and years', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toBe(3)
    expect(daysBetween('2025-12-30', '2026-01-02')).toBe(3)
  })

  it('is zero rather than NaN on nonsense input', () => {
    expect(daysBetween('not-a-day', TODAY)).toBe(0)
  })
})

describe('isOverdue', () => {
  it('is true only for open work whose day has passed', () => {
    expect(isOverdue(task({ id: '1', plannedFor: '2026-08-26' }), TODAY)).toBe(true)
  })

  it("does not nag about today's work, which has not been missed yet", () => {
    expect(isOverdue(task({ id: '1', plannedFor: TODAY }), TODAY)).toBe(false)
  })

  it('ignores the future and anything finished', () => {
    expect(isOverdue(task({ id: '1', plannedFor: '2026-08-28' }), TODAY)).toBe(false)
    expect(
      isOverdue(task({ id: '2', plannedFor: '2026-08-20', status: 'done' }), TODAY),
    ).toBe(false)
  })
})

describe('buildSuggestions', () => {
  it('suggests nothing when nothing was missed', () => {
    expect(buildSuggestions([task({ id: 'today' })], [], TODAY, NOW)).toEqual([])
  })

  it('offers to resume work that was started and never finished', () => {
    const [suggestion] = buildSuggestions(
      [task({ id: 'started', plannedFor: '2026-08-25' })],
      [session('started', 45)],
      TODAY,
      NOW,
    )

    expect(suggestion?.kind).toBe('resume')
    expect(suggestion?.trackedMin).toBe(45)
    expect(suggestion?.daysOverdue).toBe(2)
  })

  it('offers to re-plan a recent miss that was never started', () => {
    const [suggestion] = buildSuggestions(
      [task({ id: 'missed', plannedFor: '2026-08-25' })],
      [],
      TODAY,
      NOW,
    )

    expect(suggestion?.kind).toBe('reschedule')
    expect(suggestion?.trackedMin).toBe(0)
  })

  it('questions work left untouched for a long time', () => {
    const [suggestion] = buildSuggestions(
      [task({ id: 'stale', plannedFor: '2026-08-01' })],
      [],
      TODAY,
      NOW,
    )

    expect(suggestion?.kind).toBe('drop')
    expect(suggestion?.daysOverdue).toBe(26)
  })

  it('treats a mis-click as never started, not as work', () => {
    const [suggestion] = buildSuggestions(
      [task({ id: 'misclick', plannedFor: '2026-08-01' })],
      [session('misclick', MEANINGFUL_MINUTES - 1)],
      TODAY,
      NOW,
    )
    expect(suggestion?.kind).toBe('drop')
  })

  it('counts invested time even on very old work, and offers to resume it', () => {
    // Time spent outranks age: abandoning started work wastes something real.
    const [suggestion] = buildSuggestions(
      [task({ id: 'old-but-started', plannedFor: '2026-07-01' })],
      [session('old-but-started', 90)],
      TODAY,
      NOW,
    )
    expect(suggestion?.kind).toBe('resume')
  })

  it('sums many sessions on one task', () => {
    const [suggestion] = buildSuggestions(
      [task({ id: 'split', plannedFor: '2026-08-25' })],
      [session('split', 20, 'a'), session('split', 25, 'b')],
      TODAY,
      NOW,
    )
    expect(suggestion?.trackedMin).toBe(45)
  })

  it('ranks started work first, then fresh misses, then stale ones', () => {
    const suggestions = buildSuggestions(
      [
        task({ id: 'stale', plannedFor: '2026-08-01' }),
        task({ id: 'fresh', plannedFor: '2026-08-26' }),
        task({ id: 'started', plannedFor: '2026-08-20' }),
      ],
      [session('started', 30)],
      TODAY,
      NOW,
    )
    expect(suggestions.map((s) => s.taskId)).toEqual(['started', 'fresh', 'stale'])
  })

  it('breaks ties deterministically, so the list does not reshuffle on re-render', () => {
    const first = buildSuggestions(
      [
        task({ id: 'b', plannedFor: '2026-08-25' }),
        task({ id: 'a', plannedFor: '2026-08-25' }),
      ],
      [],
      TODAY,
      NOW,
    )
    expect(first.map((s) => s.taskId)).toEqual(['a', 'b'])
  })

  it('lets priority break a tie between equal misses', () => {
    const suggestions = buildSuggestions(
      [
        task({ id: 'normal', plannedFor: '2026-08-25', priority: 0 }),
        task({ id: 'urgent', plannedFor: '2026-08-25', priority: 2 }),
      ],
      [],
      TODAY,
      NOW,
    )
    expect(suggestions[0]?.taskId).toBe('urgent')
  })

  it('never reports fewer than one day overdue', () => {
    const [suggestion] = buildSuggestions(
      [task({ id: 'yesterday', plannedFor: '2026-08-26' })],
      [],
      TODAY,
      NOW,
    )
    expect(suggestion?.daysOverdue).toBe(1)
  })

  it('ignores sessions belonging to other tasks', () => {
    const [suggestion] = buildSuggestions(
      [task({ id: 'mine', plannedFor: '2026-08-25' })],
      [session('someone-else', 60)],
      TODAY,
      NOW,
    )
    expect(suggestion?.trackedMin).toBe(0)
    expect(suggestion?.kind).toBe('reschedule')
  })
})

describe('reasonFor', () => {
  it('states the measured numbers, never an invented claim', () => {
    const [resume] = buildSuggestions(
      [task({ id: 'r', plannedFor: '2026-08-25' })],
      [session('r', 45)],
      TODAY,
      NOW,
    )
    expect(reasonFor(resume!)).toBe('45m already tracked, then it stalled 2 days ago.')
  })

  it('reads hours and minutes past an hour', () => {
    const [resume] = buildSuggestions(
      [task({ id: 'r', plannedFor: '2026-08-26' })],
      [session('r', 95)],
      TODAY,
      NOW,
    )
    expect(reasonFor(resume!)).toBe('1h 35m already tracked, then it stalled 1 day ago.')
  })

  it('uses the singular for a single day', () => {
    const [fresh] = buildSuggestions(
      [task({ id: 'f', plannedFor: '2026-08-26' })],
      [],
      TODAY,
      NOW,
    )
    expect(reasonFor(fresh!)).toBe('Planned 1 day ago and never started.')
  })

  it('says plainly why old untouched work is being questioned', () => {
    const [stale] = buildSuggestions(
      [task({ id: 's', plannedFor: '2026-08-01' })],
      [],
      TODAY,
      NOW,
    )
    expect(reasonFor(stale!)).toBe('Open 26 days past its day and never started.')
  })
})

describe('countSuggestions', () => {
  it('counts each kind and the time stranded in unfinished work', () => {
    const suggestions = buildSuggestions(
      [
        task({ id: 'started', plannedFor: '2026-08-25' }),
        task({ id: 'fresh', plannedFor: '2026-08-26' }),
        task({ id: 'stale', plannedFor: '2026-08-01' }),
      ],
      [session('started', 30)],
      TODAY,
      NOW,
    )

    expect(countSuggestions(suggestions)).toEqual({
      total: 3,
      resume: 1,
      reschedule: 1,
      drop: 1,
      strandedMin: 30,
    })
  })

  it('is all zeroes with nothing to reconsider', () => {
    expect(countSuggestions([])).toEqual({
      total: 0,
      resume: 0,
      reschedule: 0,
      drop: 0,
      strandedMin: 0,
    })
  })
})

describe('labels and dates', () => {
  it('has a label for every kind', () => {
    expect(Object.keys(KIND_LABELS).sort()).toEqual(['drop', 'reschedule', 'resume'])
  })

  it('moves work to tomorrow rather than piling it onto today', () => {
    expect(tomorrowOf(TODAY)).toBe('2026-08-28')
    expect(tomorrowOf('2026-08-31')).toBe('2026-09-01')
  })

  it('agrees with its own staleness threshold', () => {
    const justUnder = buildSuggestions(
      [task({ id: 'a', plannedFor: '2026-08-14' })],
      [],
      TODAY,
      NOW,
    )
    expect(justUnder[0]?.daysOverdue).toBe(13)
    expect(justUnder[0]?.kind).toBe('reschedule')

    const atThreshold = buildSuggestions(
      [task({ id: 'b', plannedFor: '2026-08-13' })],
      [],
      TODAY,
      NOW,
    )
    expect(atThreshold[0]?.daysOverdue).toBe(STALE_DAYS)
    expect(atThreshold[0]?.kind).toBe('drop')
  })
})
