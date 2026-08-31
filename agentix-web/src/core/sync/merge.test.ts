import { describe, expect, it } from 'vitest'
import type { Syncable } from '../db/types'
import {
  addCounts,
  describeCounts,
  emptyCounts,
  isPushable,
  mergePull,
  nextCursor,
  pickWinner,
  splitPushable,
} from './merge'

function row(id: string, updatedAt: string, deletedAt: string | null = null): Syncable {
  return { id, updatedAt, deletedAt }
}

const EARLY = '2026-08-27T09:00:00.000Z'
const LATE = '2026-08-27T11:00:00.000Z'

describe('pickWinner', () => {
  it('takes the later write', () => {
    expect(pickWinner(row('a', LATE), row('a', EARLY))).toBe('local')
    expect(pickWinner(row('a', EARLY), row('a', LATE))).toBe('remote')
  })

  it('resolves an exact tie to remote, deterministically', () => {
    // Two devices disagreeing about a tie would bounce the row forever.
    expect(pickWinner(row('a', EARLY), row('a', EARLY))).toBe('remote')
  })

  it('treats a soft delete as an ordinary edit', () => {
    const deletedLater = row('a', LATE, LATE)
    expect(pickWinner(deletedLater, row('a', EARLY))).toBe('local')
    expect(pickWinner(row('a', EARLY), deletedLater)).toBe('remote')
  })
})

describe('isPushable', () => {
  it('holds a running timer back', () => {
    // Pushing an open session lets another device close or duplicate it.
    const running = { ...row('s', LATE), endedAt: null }
    expect(isPushable('sessions', running as Syncable)).toBe(false)
  })

  it('releases the session once it is closed', () => {
    const closed = { ...row('s', LATE), endedAt: LATE }
    expect(isPushable('sessions', closed as Syncable)).toBe(true)
  })

  it('never holds back any other table', () => {
    expect(isPushable('tasks', row('t', LATE))).toBe(true)
    expect(isPushable('notes', row('n', LATE))).toBe(true)
  })
})

describe('mergePull', () => {
  it('applies a row this device has never seen', () => {
    const decision = mergePull([], [row('a', EARLY)])
    expect(decision.apply.map((r) => r.id)).toEqual(['a'])
    expect(decision.keptLocal).toEqual([])
  })

  it('applies a newer server copy over an older local one', () => {
    const decision = mergePull([row('a', EARLY)], [row('a', LATE)])
    expect(decision.apply.map((r) => r.id)).toEqual(['a'])
  })

  it('keeps an offline edit that is newer than the server copy', () => {
    // The whole point of offline-first: a later local edit is not overwritten.
    const decision = mergePull([row('a', LATE)], [row('a', EARLY)])
    expect(decision.apply).toEqual([])
    expect(decision.keptLocal.map((r) => r.id)).toEqual(['a'])
  })

  it('does nothing when both sides carry the same timestamp', () => {
    // The cursor rewinds a millisecond each pull, so the newest row arrives again
    // every time. Rewriting it forever is the bug this prevents.
    const decision = mergePull([row('a', LATE)], [row('a', LATE)])
    expect(decision.apply).toEqual([])
    expect(decision.keptLocal).toEqual([])
    expect(decision.unchanged.map((r) => r.id)).toEqual(['a'])
  })

  it('leaves local-only rows alone entirely', () => {
    const decision = mergePull([row('local-only', LATE)], [row('remote', EARLY)])
    expect(decision.apply.map((r) => r.id)).toEqual(['remote'])
  })

  it('handles a mixed batch', () => {
    const decision = mergePull(
      [row('older', EARLY), row('newer', LATE)],
      [row('older', LATE), row('newer', EARLY), row('fresh', EARLY)],
    )
    expect(decision.apply.map((r) => r.id).sort()).toEqual(['fresh', 'older'])
    expect(decision.keptLocal.map((r) => r.id)).toEqual(['newer'])
  })

  it('propagates a remote delete when it is the later edit', () => {
    const decision = mergePull([row('a', EARLY)], [row('a', LATE, LATE)])
    expect(decision.apply[0]?.deletedAt).toBe(LATE)
  })
})

describe('splitPushable', () => {
  it('sends closed sessions and holds the running one', () => {
    const { batch, held } = splitPushable('sessions', [
      { entryId: 'sessions:a', row: { ...row('a', LATE), endedAt: LATE } as Syncable },
      { entryId: 'sessions:b', row: { ...row('b', LATE), endedAt: null } as Syncable },
    ])

    expect(batch.rows.map((r) => r.id)).toEqual(['a'])
    expect(batch.entryIds).toEqual(['sessions:a'])
    // The held entry stays queued, so it goes out on a later push.
    expect(held).toEqual(['sessions:b'])
  })

  it('sends everything for a table with no hold-back rule', () => {
    const { batch, held } = splitPushable('tasks', [
      { entryId: 'tasks:a', row: row('a', LATE) },
      { entryId: 'tasks:b', row: row('b', EARLY) },
    ])
    expect(batch.rows).toHaveLength(2)
    expect(held).toEqual([])
  })

  it('produces an empty batch rather than failing on nothing queued', () => {
    const { batch, held } = splitPushable('tasks', [])
    expect(batch.rows).toEqual([])
    expect(held).toEqual([])
  })
})

describe('nextCursor', () => {
  it('advances to just before the newest row seen', () => {
    // One millisecond back, so a row written in the same millisecond is not
    // skipped. Re-fetching is harmless; skipping loses an edit.
    expect(nextCursor(EARLY, [row('a', LATE)])).toBe('2026-08-27T10:59:59.999Z')
  })

  it('stays put when nothing newer arrived', () => {
    expect(nextCursor(LATE, [row('a', EARLY)])).toBe(LATE)
    expect(nextCursor(LATE, [])).toBe(LATE)
  })

  it('ignores an unparseable timestamp rather than corrupting the cursor', () => {
    expect(nextCursor(EARLY, [row('a', 'not-a-date')])).toBe(EARLY)
  })
})

describe('counts', () => {
  it('accumulates across tables', () => {
    let counts = emptyCounts()
    counts = addCounts(counts, { pushed: 2 })
    counts = addCounts(counts, { pulled: 3, conflicts: 1 })

    expect(counts).toEqual({ pushed: 2, pulled: 3, held: 0, conflicts: 1 })
  })

  it('describes an idle sync as up to date, not as zeroes', () => {
    expect(describeCounts(emptyCounts())).toBe('Already up to date.')
  })

  it('describes what actually happened', () => {
    expect(describeCounts({ pushed: 2, pulled: 1, held: 1, conflicts: 0 })).toBe(
      '2 sent · 1 received · 1 waiting on a running timer',
    )
  })
})
