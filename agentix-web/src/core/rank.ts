import { type DayKey, localDayOf, shiftDay, todayKey } from './dates'
import type { Task } from './db/types'

/**
 * Progress, as a level and a rank you climb by finishing work.
 *
 * Pure, no React, no Dexie — the Swift build translates this file directly, and
 * the numbers must come out identical on both platforms or two devices would show
 * two different levels for the same history.
 *
 * The design goal is that the score rewards the behaviour the rest of the app is
 * already about: not just *doing* things, but planning them (an estimate),
 * meaning them (priority), and actually spending focused time on them. That is why
 * XP is not simply a task count — a count would reward chopping one job into ten.
 *
 * Everything here is derived from data the app already holds. Nothing is stored:
 * replay the same completed tasks and you get the same level, so there is no
 * separate score to keep in sync, corrupt, or cheat.
 */

/* ── XP for one finished task ───────────────────────────────────────────────── */

/** Every completed task is worth at least this. */
export const XP_BASE = 10
/** Finishing something you bothered to estimate — planning is the habit to reward. */
export const XP_WITH_ESTIMATE = 5
/** Per priority step (0/1/2), so meaning a task counts for more than volume. */
export const XP_PER_PRIORITY = 5
/** One point per ten focused minutes logged against the task… */
export const XP_PER_FOCUS_10MIN = 1
/** …up to a ceiling, so a forgotten running timer cannot mint a level. */
export const XP_FOCUS_CAP = 30

/**
 * What one task contributes.
 *
 * Zero unless it is genuinely done: an open task, or one whose `completedAt` was
 * cleared by reopening it, has earned nothing yet. `focusMin` is the total closed
 * focus time on that task, which the caller sums from its sessions.
 */
export function xpForTask(task: Task, focusMin = 0): number {
  if (task.status !== 'done' || task.completedAt === null) return 0

  let xp = XP_BASE
  if (task.estimateMin !== null) xp += XP_WITH_ESTIMATE
  xp += Math.max(0, Math.min(2, task.priority)) * XP_PER_PRIORITY
  xp += Math.min(XP_FOCUS_CAP, Math.floor(Math.max(0, focusMin) / 10) * XP_PER_FOCUS_10MIN)
  return xp
}

/* ── Levels ─────────────────────────────────────────────────────────────────── */

/** A ceiling, so the curve and the UI never have to reason about infinity. */
export const MAX_LEVEL = 99

/**
 * The XP cost of the step *from* `level` to the next one.
 *
 * Linear growth: level 1→2 costs 60, each level 20 more than the last. Gentle
 * early so the first few ranks arrive quickly, then a steady climb rather than an
 * exponential wall that makes the top unreachable for a real person.
 */
export function levelStepCost(level: number): number {
  return 40 + 20 * level
}

/**
 * Total XP needed to *reach* a level (level 1 sits at 0).
 *
 * Closed form of the running sum of `levelStepCost`, so this is O(1) rather than a
 * loop — it is called for every level boundary the UI draws.
 */
export function xpToReachLevel(level: number): number {
  const n = Math.max(1, level) - 1
  return 40 * n + 10 * n * (n + 1)
}

export interface LevelInfo {
  level: number
  totalXp: number
  /** XP earned since this level began. */
  xpIntoLevel: number
  /** XP the whole current level spans; 0 at the cap. */
  xpForLevel: number
  /** XP still to the next level; 0 at the cap. */
  xpToNext: number
  /** 0..1 across the current level. 1 at the cap. */
  progress: number
  atMax: boolean
}

/** Resolves a total XP into a level and how far through it you are. */
export function levelForXp(totalXp: number): LevelInfo {
  const xp = Math.max(0, Math.floor(totalXp))

  let level = 1
  while (level < MAX_LEVEL && xpToReachLevel(level + 1) <= xp) level++

  const start = xpToReachLevel(level)
  const atMax = level >= MAX_LEVEL
  const xpForLevel = atMax ? 0 : xpToReachLevel(level + 1) - start
  const xpIntoLevel = xp - start
  const xpToNext = atMax ? 0 : xpForLevel - xpIntoLevel
  const progress = atMax ? 1 : xpForLevel === 0 ? 0 : xpIntoLevel / xpForLevel

  return { level, totalXp: xp, xpIntoLevel, xpForLevel, xpToNext, progress, atMax }
}

/* ── Ranks (named tiers over the levels) ────────────────────────────────────── */

/**
 * The tiers, and the level each one opens at. Named, not numbered, because a rank
 * is the thing you tell someone — "I'm a Lead" — and the colour is the thing
 * you see. The UI owns the colour; this stays pure and returns the key.
 */
export interface Tier {
  key: 'intern' | 'junior' | 'senior' | 'lead' | 'director' | 'executive' | 'professor'
  name: string
  minLevel: number
}

/**
 * A career ladder rather than a game-fantasy one: the ranks read like titles you
 * would actually hold, so the business view — where a whole team sees them — lands
 * as "how senior does your discipline make you look", not "who has the shiniest
 * badge".
 */
export const TIERS: readonly Tier[] = [
  { key: 'intern', name: 'Intern', minLevel: 1 },
  { key: 'junior', name: 'Junior', minLevel: 5 },
  { key: 'senior', name: 'Senior', minLevel: 10 },
  { key: 'lead', name: 'Lead', minLevel: 20 },
  { key: 'director', name: 'Director', minLevel: 35 },
  { key: 'executive', name: 'Executive', minLevel: 55 },
  { key: 'professor', name: 'Professor', minLevel: 80 },
]

/** The tier a level belongs to. */
export function tierForLevel(level: number): Tier {
  let current = TIERS[0]!
  for (const tier of TIERS) if (level >= tier.minLevel) current = tier
  return current
}

/** The tier above the current one, or null at the top. */
export function nextTier(level: number): Tier | null {
  return TIERS.find((tier) => tier.minLevel > level) ?? null
}

/* ── Streaks (the discipline the business view is about) ────────────────────── */

export interface Streaks {
  /** Consecutive days up to today (or yesterday, so it survives until midnight). */
  current: number
  /** The longest run ever recorded. */
  longest: number
}

/**
 * Current and longest streak from the set of days something was completed.
 *
 * Forgiving at the near end on purpose: a day with nothing done does not snap the
 * streak until it is actually over. So the current run may end on today or on
 * yesterday — either keeps it alive — but a two-day gap ends it.
 */
export function streaks(days: Iterable<DayKey>, today: DayKey = todayKey()): Streaks {
  const set = new Set(days)
  if (set.size === 0) return { current: 0, longest: 0 }

  // Current: walk back from whichever of today/yesterday actually has activity.
  let anchor: DayKey | null = set.has(today)
    ? today
    : set.has(shiftDay(today, -1))
      ? shiftDay(today, -1)
      : null
  let current = 0
  while (anchor !== null && set.has(anchor)) {
    current++
    anchor = shiftDay(anchor, -1)
  }

  // Longest: sort the days and measure the longest consecutive run.
  const sorted = [...set].sort()
  let longest = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === shiftDay(sorted[i - 1]!, 1) ? run + 1 : 1
    if (run > longest) longest = run
  }

  return { current, longest }
}

/* ── Crossing a boundary ────────────────────────────────────────────────────── */

export interface LevelUp {
  /** The level left behind. */
  from: number
  to: number
  /** The rank held at the new level. */
  tier: Tier
  /** True when the climb also opened a new rank — the louder of the two moments. */
  promoted: boolean
}

/**
 * What happened between two levels, or `null` if nothing did.
 *
 * Pure and stateless on purpose: the caller owns the memory of where you were, so
 * the same function serves the live case (a task finished a moment ago) and the
 * cold one (levels earned while the app was closed, noticed on next open). Several
 * levels at once collapse into one event — the arrival is the moment, not each
 * boundary crossed on the way.
 *
 * A drop is not an event. Reopening a task or restoring a smaller backup can lower
 * the number, and that is a correction, not something to celebrate or mourn.
 */
export function levelUp(from: number, to: number): LevelUp | null {
  if (!(to > from)) return null
  return {
    from,
    to,
    tier: tierForLevel(to),
    promoted: tierForLevel(to).key !== tierForLevel(from).key,
  }
}

/* ── The whole snapshot the UI reads ────────────────────────────────────────── */

export interface RankSnapshot {
  totalXp: number
  level: LevelInfo
  tier: Tier
  nextTier: Tier | null
  /** Lifetime completed tasks. */
  completedTotal: number
  /** Completed within the last 7 and 30 local days. */
  completed7: number
  completed30: number
  current: number
  longest: number
  /** Distinct days with a completion in the last 30 — the discipline read. */
  activeDays30: number
}

export interface RankInput {
  tasks: Task[]
  /** Total closed focus minutes per task id. Absent tasks count as zero focus. */
  focusByTask?: Map<string, number>
  today?: DayKey
}

/**
 * Everything the rank surface shows, from the raw task list.
 *
 * One pass over the completed tasks: it sums XP, counts recency windows, and
 * gathers the days work was finished — which the streak reads from.
 */
export function computeRank({ tasks, focusByTask, today = todayKey() }: RankInput): RankSnapshot {
  const done = tasks.filter((task) => task.status === 'done' && task.completedAt !== null)

  const cutoff7 = shiftDay(today, -6)
  const cutoff30 = shiftDay(today, -29)

  let totalXp = 0
  let completed7 = 0
  let completed30 = 0
  const days = new Set<DayKey>()
  const days30 = new Set<DayKey>()

  for (const task of done) {
    totalXp += xpForTask(task, focusByTask?.get(task.id) ?? 0)
    const day = localDayOf(task.completedAt!)
    days.add(day)
    if (day >= cutoff7) completed7++
    if (day >= cutoff30) {
      completed30++
      days30.add(day)
    }
  }

  const level = levelForXp(totalXp)
  const { current, longest } = streaks(days, today)

  return {
    totalXp,
    level,
    tier: tierForLevel(level.level),
    nextTier: nextTier(level.level),
    completedTotal: done.length,
    completed7,
    completed30,
    current,
    longest,
    activeDays30: days30.size,
  }
}

/** A fresh, empty snapshot — what a brand-new device shows before its first task. */
export function emptyRank(today: DayKey = todayKey()): RankSnapshot {
  return computeRank({ tasks: [], today })
}
