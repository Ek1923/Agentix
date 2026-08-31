import { describe, expect, it } from 'vitest'
import type { Task } from './db/types'
import {
  MAX_LEVEL,
  XP_BASE,
  XP_FOCUS_CAP,
  XP_PER_PRIORITY,
  XP_WITH_ESTIMATE,
  computeRank,
  emptyRank,
  levelForXp,
  levelUp,
  nextTier,
  streaks,
  tierForLevel,
  xpForTask,
  xpToReachLevel,
} from './rank'

function task(overrides: Partial<Task> & { id: string }): Task {
  const base: Task = {
    id: overrides.id,
    title: overrides.id,
    notes: null,
    link: null,
    status: 'done',
    bucketId: 'done',
    assigneeIds: [],
    plannedFor: '2026-08-31',
    estimateMin: null,
    completedAt: '2026-08-31T10:00:00.000Z',
    priority: 0,
    tags: [],
    habitId: null,
    createdAt: '2026-08-30T09:00:00.000Z',
    updatedAt: '2026-08-31T10:00:00.000Z',
    deletedAt: null,
  }
  return Object.assign(base, overrides)
}

describe('xp for a task', () => {
  it('earns nothing until it is genuinely done', () => {
    expect(xpForTask(task({ id: 'a', status: 'todo', completedAt: null }))).toBe(0)
    // Reopened: status done but no completion stamp is not a finish.
    expect(xpForTask(task({ id: 'b', completedAt: null }))).toBe(0)
  })

  it('rewards planning and meaning, not just doing', () => {
    expect(xpForTask(task({ id: 'plain' }))).toBe(XP_BASE)
    expect(xpForTask(task({ id: 'est', estimateMin: 30 }))).toBe(XP_BASE + XP_WITH_ESTIMATE)
    expect(xpForTask(task({ id: 'prio', priority: 2 }))).toBe(XP_BASE + 2 * XP_PER_PRIORITY)
  })

  it('credits focus time but caps it, so a runaway timer cannot mint a level', () => {
    expect(xpForTask(task({ id: 'f' }), 25)).toBe(XP_BASE + 2) // two whole 10-min blocks
    expect(xpForTask(task({ id: 'huge' }), 100_000)).toBe(XP_BASE + XP_FOCUS_CAP)
  })
})

describe('levels', () => {
  it('starts at level 1 with zero xp', () => {
    const info = levelForXp(0)
    expect(info.level).toBe(1)
    expect(info.progress).toBe(0)
    expect(info.xpToNext).toBe(xpToReachLevel(2))
  })

  it('crosses a boundary exactly at its cost', () => {
    const boundary = xpToReachLevel(2)
    expect(levelForXp(boundary - 1).level).toBe(1)
    expect(levelForXp(boundary).level).toBe(2)
    expect(levelForXp(boundary).xpIntoLevel).toBe(0)
  })

  it('reports progress as a real fraction of the current level', () => {
    const start = xpToReachLevel(3)
    const span = xpToReachLevel(4) - start
    const info = levelForXp(start + Math.floor(span / 2))
    expect(info.level).toBe(3)
    expect(info.progress).toBeGreaterThan(0.45)
    expect(info.progress).toBeLessThan(0.55)
  })

  it('pins at the cap without overflowing', () => {
    const info = levelForXp(xpToReachLevel(MAX_LEVEL) + 10_000)
    expect(info.level).toBe(MAX_LEVEL)
    expect(info.atMax).toBe(true)
    expect(info.progress).toBe(1)
    expect(info.xpToNext).toBe(0)
  })
})

describe('tiers', () => {
  it('names the rank a level falls in', () => {
    expect(tierForLevel(1).key).toBe('intern')
    expect(tierForLevel(4).key).toBe('intern')
    expect(tierForLevel(5).key).toBe('junior')
    expect(tierForLevel(10).key).toBe('senior')
    expect(tierForLevel(80).key).toBe('professor')
  })

  it('points at the next rank to reach, and nothing past the top', () => {
    expect(nextTier(1)?.key).toBe('junior')
    expect(nextTier(80)).toBeNull()
  })
})

describe('streaks', () => {
  const today = '2026-08-31'

  it('is zero with no history', () => {
    expect(streaks([], today)).toEqual({ current: 0, longest: 0 })
  })

  it('counts consecutive days ending today', () => {
    const s = streaks(['2026-08-29', '2026-08-30', '2026-08-31'], today)
    expect(s.current).toBe(3)
    expect(s.longest).toBe(3)
  })

  it('survives until midnight when today is still blank but yesterday was not', () => {
    const s = streaks(['2026-08-29', '2026-08-30'], today)
    expect(s.current).toBe(2)
  })

  it('breaks on a real gap, and still reports the best past run', () => {
    // Last activity was 29 Aug — two days before today (31st), past the one-day
    // grace — so the current run is broken.
    const s = streaks(['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-29'], today)
    expect(s.current).toBe(0)
    expect(s.longest).toBe(3)
  })
})

describe('computeRank', () => {
  const today = '2026-08-31'

  it('is empty and safe on a fresh device', () => {
    const snap = emptyRank(today)
    expect(snap.totalXp).toBe(0)
    expect(snap.level.level).toBe(1)
    expect(snap.completedTotal).toBe(0)
    expect(snap.current).toBe(0)
  })

  it('ignores open tasks entirely', () => {
    const snap = computeRank({
      tasks: [task({ id: 'open', status: 'todo', completedAt: null })],
      today,
    })
    expect(snap.completedTotal).toBe(0)
    expect(snap.totalXp).toBe(0)
  })

  it('sums xp and folds in per-task focus time', () => {
    const snap = computeRank({
      tasks: [task({ id: 'a', estimateMin: 30 }), task({ id: 'b', priority: 1 })],
      focusByTask: new Map([['a', 20]]),
      today,
    })
    // a: 10 + 5(estimate) + 2(focus) = 17 ; b: 10 + 5(priority) = 15
    expect(snap.totalXp).toBe(32)
    expect(snap.completedTotal).toBe(2)
  })

  it('windows recent completions by local day', () => {
    const snap = computeRank({
      tasks: [
        task({ id: 'today', completedAt: '2026-08-31T08:00:00.000Z' }),
        task({ id: 'week', completedAt: '2026-08-27T08:00:00.000Z' }),
        task({ id: 'old', completedAt: '2026-07-01T08:00:00.000Z' }),
      ],
      today,
    })
    expect(snap.completed7).toBe(2)
    expect(snap.completed30).toBe(2)
    expect(snap.completedTotal).toBe(3)
    expect(snap.activeDays30).toBe(2)
  })
})

describe('crossing a boundary', () => {
  it('is nothing at all when the level did not move, or moved down', () => {
    expect(levelUp(4, 4)).toBeNull()
    // Reopening a task or restoring a smaller backup is a correction, not an event.
    expect(levelUp(9, 6)).toBeNull()
  })

  it('reports the climb and the rank it lands in', () => {
    const event = levelUp(2, 3)
    expect(event).not.toBeNull()
    expect(event!.from).toBe(2)
    expect(event!.to).toBe(3)
    expect(event!.tier.key).toBe('intern')
    expect(event!.promoted).toBe(false)
  })

  it('marks the louder moment when a new rank opens', () => {
    // 4 → 5 is where Junior begins.
    expect(levelUp(4, 5)!.promoted).toBe(true)
    expect(levelUp(4, 5)!.tier.name).toBe('Junior')
  })

  it('collapses several levels at once into one arrival', () => {
    const event = levelUp(1, 6)!
    expect(event.from).toBe(1)
    expect(event.to).toBe(6)
    expect(event.promoted).toBe(true)
    expect(event.tier.key).toBe('junior')
  })
})
