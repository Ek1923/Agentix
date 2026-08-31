import { useCallback, useSyncExternalStore } from 'react'
import { onLocalChange } from '../core/db/changes'
import { queries } from '../core/db/queries'
import { computeRank, emptyRank, levelUp, type LevelUp, type RankSnapshot } from '../core/rank'

/**
 * The rank for the person using this device: one score, computed once, shared by
 * everything that shows it.
 *
 * A module-level store rather than per-component state, for two reasons. The
 * score is a fold over every task ever finished, so two components each running
 * their own copy would scan storage twice to reach the same number. And a level-up
 * is a single event — if two hooks noticed it independently, it would be
 * celebrated twice.
 *
 * It recomputes on the three moments the number can move: a write to storage
 * (`core/db/changes`, which every mutation and every pulled row announces), coming
 * back to the tab, and being asked to. Not a Dexie live query: that would re-run
 * the whole scan on every keystroke in an unrelated table.
 */

interface RankState {
  snapshot: RankSnapshot
  /** A level crossed and not yet acknowledged; `null` the rest of the time. */
  celebration: LevelUp | null
}

/**
 * Where the last level we have already shown someone is remembered.
 *
 * Persisted because levels are earned in moments the app is not being watched —
 * finish the last task of the day, close the tab, and the promotion would
 * otherwise happen to nobody. On next open the stored level is behind the computed
 * one, and the moment is delivered late rather than lost.
 */
const SEEN_KEY = 'agentix.rank.seenLevel'

function readSeen(): number | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (raw === null) return null
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) ? value : null
  } catch {
    // Private mode, or storage denied. The rank still works; only the memory of
    // having seen it is lost.
    return null
  }
}

function writeSeen(level: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(level))
  } catch {
    // As above.
  }
}

let state: RankState = { snapshot: emptyRank(), celebration: null }
const subscribers = new Set<() => void>()

function setState(next: RankState): void {
  state = next
  for (const notify of [...subscribers]) notify()
}

/** Total closed focus minutes per task, which XP folds in. */
function focusMinutesByTask(
  sessions: { taskId: string; startedAt: string; endedAt: string | null }[],
): Map<string, number> {
  const focus = new Map<string, number>()
  for (const session of sessions) {
    if (session.endedAt === null) continue
    const minutes =
      (new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60_000
    if (minutes > 0) focus.set(session.taskId, (focus.get(session.taskId) ?? 0) + minutes)
  }
  return focus
}

/**
 * Reads storage and publishes a fresh snapshot, raising a celebration if the level
 * went up since the last one anybody saw.
 *
 * The baseline is the stored "seen" level, falling back to the level in hand — so
 * a device opening this data for the first time (a restored backup, a new browser)
 * adopts whatever it finds silently instead of throwing a party for work it did
 * not just watch happen.
 */
async function recompute(): Promise<void> {
  const [tasks, sessions] = await Promise.all([queries.allTasks(), queries.allSessions()])
  const snapshot = computeRank({ tasks, focusByTask: focusMinutesByTask(sessions) })
  const level = snapshot.level.level

  const seen = readSeen()
  const event = seen === null ? null : levelUp(seen, level)
  if (seen !== level) writeSeen(level)

  setState({ snapshot, celebration: event ?? state.celebration })
}

let running: Promise<void> | null = null

/** Recomputes, coalescing calls that arrive while a read is already in flight. */
export function refreshRank(): void {
  if (running !== null) return
  running = recompute()
    .catch(() => {
      // Storage unavailable; keep the last good snapshot rather than blanking it.
    })
    .finally(() => {
      running = null
    })
}

/**
 * Writes arrive in bursts — finishing a task touches the task, its bucket and any
 * running session inside one transaction. Waiting a beat turns that into one read.
 */
const COALESCE_MS = 150
let pending: ReturnType<typeof setTimeout> | null = null

function onStorageWrote(table: string): void {
  if (table !== 'tasks' && table !== 'sessions') return
  if (pending !== null) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    refreshRank()
  }, COALESCE_MS)
}

let detach: (() => void) | null = null

/**
 * The listeners are attached while anything is watching and torn down when the
 * last watcher leaves, so a headless import of this module costs nothing.
 */
function subscribe(notify: () => void): () => void {
  const first = subscribers.size === 0
  subscribers.add(notify)

  if (first) {
    detach = attach()
    refreshRank()
  }

  return () => {
    subscribers.delete(notify)
    if (subscribers.size === 0) {
      detach?.()
      detach = null
      if (pending !== null) {
        clearTimeout(pending)
        pending = null
      }
    }
  }
}

function attach(): () => void {
  const stopListening = onLocalChange(onStorageWrote)
  if (typeof window === 'undefined') return stopListening

  const onVisible = () => {
    if (document.visibilityState === 'visible') refreshRank()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', refreshRank)

  return () => {
    stopListening()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', refreshRank)
  }
}

const getState = (): RankState => state

/**
 * The current rank. Returns the empty snapshot until the first read resolves, so a
 * surface renders level 1 rather than flashing nothing.
 */
export function useRank(): { snapshot: RankSnapshot; refresh: () => void } {
  const current = useSyncExternalStore(subscribe, getState, getState)
  return { snapshot: current.snapshot, refresh: refreshRank }
}

/** The unacknowledged level-up, for whatever is going to make a moment of it. */
export function useLevelUp(): { celebration: LevelUp | null; dismiss: () => void } {
  const current = useSyncExternalStore(subscribe, getState, getState)
  const dismiss = useCallback(() => {
    if (state.celebration !== null) setState({ ...state, celebration: null })
  }, [])
  return { celebration: current.celebration, dismiss }
}

/** Test seam: forgets everything this module remembers between cases. */
export function __resetRankStore(): void {
  state = { snapshot: emptyRank(), celebration: null }
  try {
    localStorage.removeItem(SEEN_KEY)
  } catch {
    // Nothing to forget.
  }
}
