/**
 * Duration maths for the timer. Pure functions, no React, no Dexie — this file is
 * the specification the Swift build translates line by line.
 *
 * The central rule: elapsed time is always *derived* from `startedAt` and the
 * current clock, never accumulated in a counter. A counter stops when the tab
 * closes; two timestamps do not. That is the whole reason a timer survives a
 * closed tab, and it is why nothing here holds state.
 */

export interface SessionLike {
  startedAt: string
  endedAt: string | null
}

export const MINUTE_MS = 60_000
export const HOUR_MS = 3_600_000

export function isRunning(session: SessionLike): boolean {
  return session.endedAt === null
}

/**
 * How long a session lasted, or has lasted so far if it is still running.
 *
 * Clamped at zero: a device whose clock moves backwards must not produce negative
 * time, which would silently subtract from a day's total.
 */
export function sessionDurationMs(session: SessionLike, nowIso: string): number {
  const start = Date.parse(session.startedAt)
  const end = session.endedAt === null ? Date.parse(nowIso) : Date.parse(session.endedAt)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, end - start)
}

export function totalDurationMs(sessions: SessionLike[], nowIso: string): number {
  return sessions.reduce((sum, s) => sum + sessionDurationMs(s, nowIso), 0)
}

export function totalMinutes(sessions: SessionLike[], nowIso: string): number {
  return Math.round(totalDurationMs(sessions, nowIso) / MINUTE_MS)
}

/**
 * Human-readable, for totals: "2h 05m", "45m", "30s".
 *
 * Seconds appear only under a minute — on a total, a ticking seconds field is
 * noise that redraws every second and tells the reader nothing.
 */
export function formatDuration(ms: number): string {
  if (ms < MINUTE_MS) return `${Math.floor(ms / 1000)}s`

  const hours = Math.floor(ms / HOUR_MS)
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

/** Monospaced clock for a running timer: "0:00:07", "1:23:45". */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Estimate versus reality, in minutes. Positive means it took longer than guessed.
 * Null when there was no estimate to compare against — an absent estimate is not
 * an estimate of zero, and scoring it as one would poison the accuracy numbers
 * the backtest plugin reads later.
 */
export function estimateDeltaMin(
  estimateMin: number | null,
  actualMin: number,
): number | null {
  if (estimateMin === null) return null
  return actualMin - estimateMin
}
