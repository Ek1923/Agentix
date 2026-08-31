import { describe, expect, it } from 'vitest'
import type { Task, TimeSession } from '../../../core/db/types'
import {
  canTrack,
  groupSessionsByTask,
  isValidTitle,
  parseEstimate,
  sortForDay,
  summarize,
  toggledStatus,
} from './tasks'

function task(overrides: Partial<Task> & { id: string }): Task {
  const base: Task = {
    id: overrides.id,
    title: overrides.id,
    notes: null,
    link: null,
    status: 'todo',
    bucketId: 'bucket-todo',
    assigneeIds: [],
    plannedFor: '2026-08-27',
    estimateMin: null,
    completedAt: null,
    priority: 0,
    tags: [],
    habitId: null,
    createdAt: '2026-08-27T09:00:00.000Z',
    updatedAt: '2026-08-27T09:00:00.000Z',
    deletedAt: null,
  }
  // Object.assign rather than a spread: spreading a Partial<Task> widens every
  // optional field to include undefined, which Task does not allow.
  return Object.assign(base, overrides)
}

describe('sortForDay', () => {
  it('puts the running task first, then open work, then missed, then done', () => {
    const ordered = sortForDay([
      task({ id: 'done', status: 'done' }),
      task({ id: 'todo', status: 'todo' }),
      task({ id: 'missed', status: 'missed' }),
      task({ id: 'active', status: 'active' }),
    ])
    expect(ordered.map((t) => t.id)).toEqual(['active', 'todo', 'missed', 'done'])
  })

  it('ranks higher priority first within the same status', () => {
    const ordered = sortForDay([
      task({ id: 'normal', priority: 0 }),
      task({ id: 'urgent', priority: 2 }),
      task({ id: 'high', priority: 1 }),
    ])
    expect(ordered.map((t) => t.id)).toEqual(['urgent', 'high', 'normal'])
  })

  it('breaks ties by creation order so the list does not reshuffle while read', () => {
    const ordered = sortForDay([
      task({ id: 'second', createdAt: '2026-08-27T10:00:00.000Z' }),
      task({ id: 'first', createdAt: '2026-08-27T09:00:00.000Z' }),
    ])
    expect(ordered.map((t) => t.id)).toEqual(['first', 'second'])
  })

  it('does not mutate the array it was given', () => {
    const input = [task({ id: 'b', priority: 0 }), task({ id: 'a', priority: 2 })]
    sortForDay(input)
    expect(input.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('summarize', () => {
  it('counts done against total and sums tracked time', () => {
    const tasks = [
      task({ id: '1', status: 'done' }),
      task({ id: '2', status: 'todo' }),
      task({ id: '3', status: 'active' }),
    ]
    const sessions = [
      { startedAt: '2026-08-27T09:00:00.000Z', endedAt: '2026-08-27T09:30:00.000Z' },
    ]

    expect(summarize(tasks, sessions, '2026-08-27T12:00:00.000Z')).toEqual({
      total: 3,
      done: 1,
      remaining: 2,
      trackedMs: 30 * 60_000,
    })
  })
})

describe('groupSessionsByTask', () => {
  it('buckets sessions by their task in one pass', () => {
    const sessions = [
      { id: 's1', taskId: 'a' },
      { id: 's2', taskId: 'b' },
      { id: 's3', taskId: 'a' },
    ] as TimeSession[]

    const grouped = groupSessionsByTask(sessions)
    expect(grouped.get('a')?.map((s) => s.id)).toEqual(['s1', 's3'])
    expect(grouped.get('b')?.map((s) => s.id)).toEqual(['s2'])
    expect(grouped.get('missing')).toBeUndefined()
  })
})

describe('canTrack', () => {
  it('refuses to accrue more time against finished work', () => {
    expect(canTrack(task({ id: '1', status: 'done' }))).toBe(false)
    expect(canTrack(task({ id: '2', status: 'todo' }))).toBe(true)
    expect(canTrack(task({ id: '3', status: 'missed' }))).toBe(true)
  })
})

describe('toggledStatus', () => {
  it('ticks a task done and un-ticks it back to todo, never to active', () => {
    expect(toggledStatus(task({ id: '1', status: 'todo' }))).toBe('done')
    expect(toggledStatus(task({ id: '2', status: 'active' }))).toBe('done')
    // Reviving a task must not imply its clock is running.
    expect(toggledStatus(task({ id: '3', status: 'done' }))).toBe('todo')
  })
})

describe('input parsing', () => {
  it('rejects a blank or whitespace-only title', () => {
    expect(isValidTitle('Write the brief')).toBe(true)
    expect(isValidTitle('   ')).toBe(false)
    expect(isValidTitle('')).toBe(false)
  })

  it('reads an estimate, and treats blank as "no estimate" rather than zero', () => {
    expect(parseEstimate('45')).toBe(45)
    expect(parseEstimate(' 30 ')).toBe(30)
    expect(parseEstimate('12.6')).toBe(13)
    expect(parseEstimate('')).toBeNull()
    expect(parseEstimate('   ')).toBeNull()
  })

  it('rejects nonsense instead of storing NaN', () => {
    expect(parseEstimate('abc')).toBeNull()
    expect(parseEstimate('-5')).toBeNull()
    expect(parseEstimate('0')).toBeNull()
    expect(parseEstimate('Infinity')).toBeNull()
  })
})
