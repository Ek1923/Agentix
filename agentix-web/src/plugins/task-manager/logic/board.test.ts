import { describe, expect, it } from 'vitest'
import type { Bucket, Task, TaskStatus } from '../../../core/db/types'
import {
  countBoard,
  feedbackForBucket,
  groupIntoBuckets,
  isValidBucketName,
  moveToBucket,
  tasksIn,
} from './board'

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
    createdAt: '2026-08-27T09:00:00.000Z',
    updatedAt: '2026-08-27T09:00:00.000Z',
    deletedAt: null,
  }
  // Object.assign rather than a spread: spreading a Partial<Task> widens every
  // optional field to include undefined, which Task does not allow.
  return Object.assign(base, overrides)
}

function bucket(id: string, impliesStatus: TaskStatus, order = 0, isDefault = true): Bucket {
  return {
    id,
    name: id,
    order,
    impliesStatus,
    colorId: 'slate',
    isDefault,
    createdAt: '2026-08-27T09:00:00.000Z',
    updatedAt: '2026-08-27T09:00:00.000Z',
    deletedAt: null,
  }
}

const COLUMNS = [
  bucket('todo', 'todo', 0),
  bucket('active', 'active', 1),
  bucket('done', 'done', 2),
]

const NOW = '2026-08-27T12:00:00.000Z'

describe('groupIntoBuckets', () => {
  it('always returns every column, empty or not', () => {
    const board = groupIntoBuckets([], COLUMNS)
    expect([...board.keys()]).toEqual(['todo', 'active', 'done'])
    expect(tasksIn(board, 'todo')).toEqual([])
  })

  it('files each task in the column it points at', () => {
    const board = groupIntoBuckets(
      [
        task({ id: 'a', bucketId: 'todo' }),
        task({ id: 'b', bucketId: 'active', status: 'active' }),
        task({ id: 'c', bucketId: 'done', status: 'done' }),
      ],
      COLUMNS,
    )

    expect(tasksIn(board, 'todo').map((t) => t.id)).toEqual(['a'])
    expect(tasksIn(board, 'active').map((t) => t.id)).toEqual(['b'])
    expect(tasksIn(board, 'done').map((t) => t.id)).toEqual(['c'])
  })

  it('rehomes a task whose column no longer exists rather than losing it', () => {
    const board = groupIntoBuckets([task({ id: 'orphan', bucketId: 'deleted' })], COLUMNS)
    expect(tasksIn(board, 'todo').map((t) => t.id)).toEqual(['orphan'])
  })

  it('orders within a column by priority, then creation', () => {
    const board = groupIntoBuckets(
      [
        task({ id: 'normal', priority: 0, createdAt: '2026-08-27T09:00:00.000Z' }),
        task({ id: 'urgent', priority: 2, createdAt: '2026-08-27T10:00:00.000Z' }),
        task({ id: 'high', priority: 1, createdAt: '2026-08-27T11:00:00.000Z' }),
      ],
      COLUMNS,
    )
    expect(tasksIn(board, 'todo').map((t) => t.id)).toEqual(['urgent', 'high', 'normal'])
  })

  it('handles a board with custom columns only', () => {
    const custom = [bucket('blocked', 'todo', 0, false), bucket('review', 'todo', 1, false)]
    const board = groupIntoBuckets([task({ id: 'x', bucketId: 'review' })], custom)

    expect(tasksIn(board, 'review').map((t) => t.id)).toEqual(['x'])
    expect(tasksIn(board, 'blocked')).toEqual([])
  })
})

describe('moveToBucket', () => {
  it('sets the column and the status it implies', () => {
    const patch = moveToBucket(task({ id: '1', bucketId: 'todo' }), COLUMNS[1]!, NOW)
    expect(patch).toEqual({ bucketId: 'active', status: 'active', completedAt: null })
  })

  it('stamps completion on arrival in a done column', () => {
    const patch = moveToBucket(
      task({ id: '1', bucketId: 'active', status: 'active' }),
      COLUMNS[2]!,
      NOW,
    )
    expect(patch).toEqual({ bucketId: 'done', status: 'done', completedAt: NOW })
  })

  it('clears completion when a task leaves a done column', () => {
    const finished = task({ id: '1', bucketId: 'done', status: 'done', completedAt: NOW })
    const patch = moveToBucket(finished, COLUMNS[0]!, NOW)
    expect(patch).toEqual({ bucketId: 'todo', status: 'todo', completedAt: null })
  })

  it('returns null for a card dropped back where it started', () => {
    // An identical write would still bump updatedAt, and updatedAt decides sync
    // conflicts — a no-op must not win a merge against a real edit elsewhere.
    expect(moveToBucket(task({ id: '1', bucketId: 'todo' }), COLUMNS[0]!, NOW)).toBeNull()
  })

  it('treats a custom column as open work, whatever it is called', () => {
    // Inventing columns must not be able to corrupt completion rates.
    const blocked = bucket('blocked', 'todo', 3, false)
    const patch = moveToBucket(
      task({ id: '1', bucketId: 'done', status: 'done', completedAt: NOW }),
      blocked,
      NOW,
    )
    expect(patch).toEqual({ bucketId: 'blocked', status: 'todo', completedAt: null })
  })
})

describe('countBoard', () => {
  it('counts completion by status, not by column name', () => {
    // This is what lets someone rename "Done" to "Shipped" without breaking
    // Backtest later.
    expect(
      countBoard([
        task({ id: 'a' }),
        task({ id: 'b', status: 'done', bucketId: 'shipped' }),
      ]),
    ).toEqual({ total: 2, done: 1, percentDone: 50 })
  })

  it('is zero rather than NaN on an empty board', () => {
    expect(countBoard([]).percentDone).toBe(0)
  })
})

describe('column names and feedback', () => {
  it('accepts a real name and rejects blank or overlong ones', () => {
    expect(isValidBucketName('Blocked')).toBe(true)
    expect(isValidBucketName('  Review  ')).toBe(true)
    expect(isValidBucketName('')).toBe(false)
    expect(isValidBucketName('   ')).toBe(false)
    expect(isValidBucketName('x'.repeat(41))).toBe(false)
  })

  it('celebrates arrival in a done column and stays quiet elsewhere', () => {
    expect(feedbackForBucket(COLUMNS[2]!)).toBe('success')
    expect(feedbackForBucket(COLUMNS[0]!)).toBe('light')
    expect(feedbackForBucket(bucket('blocked', 'todo', 3, false))).toBe('light')
  })
})
