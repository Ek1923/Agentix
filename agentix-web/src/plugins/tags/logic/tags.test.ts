import { describe, expect, it } from 'vitest'
import type { Task, TimeSession } from '../../../core/db/types'
import {
  addTag,
  collectTags,
  formatMinutes,
  isValidTag,
  normaliseTag,
  removeTagFrom,
  sortTagStats,
  statsByTag,
  untaggedCount,
} from './tags'

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
    plannedFor: '2026-08-27',
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

function session(taskId: string, minutes: number, id = `${taskId}-s`): TimeSession {
  const start = Date.parse('2026-08-26T09:00:00.000Z')
  return {
    id,
    taskId,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + minutes * 60_000).toISOString(),
    source: 'timer',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  }
}

describe('normaliseTag', () => {
  it('lowercases and trims, so case is never a second tag', () => {
    expect(normaliseTag('  Design  ')).toBe('design')
    expect(normaliseTag('DESIGN')).toBe('design')
  })

  it('drops a leading hash, however many', () => {
    expect(normaliseTag('#design')).toBe('design')
    expect(normaliseTag('##design')).toBe('design')
  })

  it('rejects blank and overlong tags', () => {
    expect(normaliseTag('')).toBeNull()
    expect(normaliseTag('   ')).toBeNull()
    expect(normaliseTag('#')).toBeNull()
    expect(normaliseTag('x'.repeat(33))).toBeNull()
  })

  it('agrees with isValidTag', () => {
    expect(isValidTag('client-a')).toBe(true)
    expect(isValidTag('  ')).toBe(false)
  })
})

describe('addTag and removeTagFrom', () => {
  it('adds a normalised tag', () => {
    expect(addTag([], '#Design')).toEqual(['design'])
  })

  it('never duplicates, whatever the casing', () => {
    expect(addTag(['design'], 'DESIGN')).toEqual(['design'])
    expect(addTag(['design'], '#design')).toEqual(['design'])
  })

  it('returns the list untouched for invalid input', () => {
    const tags = ['design']
    expect(addTag(tags, '   ')).toBe(tags)
  })

  it('removes a tag', () => {
    expect(removeTagFrom(['design', 'admin'], 'design')).toEqual(['admin'])
  })
})

describe('collectTags', () => {
  it('lists distinct tags, most used first', () => {
    const tags = collectTags([
      task({ id: 'a', tags: ['design', 'admin'] }),
      task({ id: 'b', tags: ['design'] }),
      task({ id: 'c', tags: ['design'] }),
    ])
    expect(tags).toEqual(['design', 'admin'])
  })

  it('breaks a tie alphabetically, so the order cannot wobble', () => {
    expect(collectTags([task({ id: 'a', tags: ['zeta', 'alpha'] })])).toEqual(['alpha', 'zeta'])
  })
})

describe('statsByTag', () => {
  it('counts tasks, completion and tracked time per tag', () => {
    const [stats] = statsByTag(
      [
        task({ id: 'a', tags: ['design'], status: 'done', estimateMin: 60 }),
        task({ id: 'b', tags: ['design'] }),
      ],
      [session('a', 90)],
      NOW,
    )

    expect(stats?.tag).toBe('design')
    expect(stats?.taskCount).toBe(2)
    expect(stats?.doneCount).toBe(1)
    expect(stats?.completionRate).toBe(50)
    expect(stats?.trackedMinutes).toBe(90)
    expect(stats?.estimatedMinutes).toBe(60)
    expect(stats?.unestimated).toBe(1)
  })

  it('counts a task fully under each of its tags', () => {
    // Answers "how much went into this tag", not "how does the total divide" —
    // which is why the plugin shows no grand total.
    const stats = statsByTag([task({ id: 'a', tags: ['design', 'admin'] })], [session('a', 60)], NOW)
    expect(stats).toHaveLength(2)
    expect(stats.every((s) => s.trackedMinutes === 60)).toBe(true)
  })

  it('has no median for a tag whose tasks were never tracked', () => {
    const [stats] = statsByTag([task({ id: 'a', tags: ['design'] })], [], NOW)
    expect(stats?.medianMinutes).toBeNull()
    expect(stats?.trackedMinutes).toBe(0)
  })

  it('takes the median across tracked tasks only', () => {
    const [stats] = statsByTag(
      [
        task({ id: 'a', tags: ['design'] }),
        task({ id: 'b', tags: ['design'] }),
        task({ id: 'c', tags: ['design'] }),
      ],
      [session('a', 30), session('b', 90)],
      NOW,
    )
    // The untracked task is absent, not a zero dragging the median down.
    expect(stats?.medianMinutes).toBe(60)
  })

  it('counts a running session up to now', () => {
    const running: TimeSession = {
      ...session('a', 0),
      startedAt: '2026-08-27T11:00:00.000Z',
      endedAt: null,
    }
    const [stats] = statsByTag([task({ id: 'a', tags: ['design'] })], [running], NOW)
    expect(stats?.trackedMinutes).toBe(60)
  })

  it('returns nothing for tasks with no tags', () => {
    expect(statsByTag([task({ id: 'a' })], [], NOW)).toEqual([])
  })
})

describe('sortTagStats', () => {
  const stats = statsByTag(
    [
      task({ id: 'a', tags: ['zeta'] }),
      task({ id: 'b', tags: ['alpha'] }),
      task({ id: 'c', tags: ['alpha'] }),
    ],
    [session('a', 120)],
    NOW,
  )

  it('sorts by tracked time', () => {
    expect(sortTagStats(stats, 'time')[0]?.tag).toBe('zeta')
  })

  it('sorts by task count', () => {
    expect(sortTagStats(stats, 'tasks')[0]?.tag).toBe('alpha')
  })

  it('sorts by name', () => {
    expect(sortTagStats(stats, 'name').map((s) => s.tag)).toEqual(['alpha', 'zeta'])
  })

  it('does not mutate the input', () => {
    const before = stats.map((s) => s.tag)
    sortTagStats(stats, 'name')
    expect(stats.map((s) => s.tag)).toEqual(before)
  })
})

describe('untaggedCount', () => {
  it('counts work that is never attributed anywhere', () => {
    expect(untaggedCount([task({ id: 'a' }), task({ id: 'b', tags: ['design'] })])).toBe(1)
  })
})

describe('formatMinutes', () => {
  it('reads minutes, hours, and a dash for nothing', () => {
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(150)).toBe('2h 30m')
    expect(formatMinutes(null)).toBe('—')
  })
})
