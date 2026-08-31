/**
 * Small statistics helpers. Pure functions, no React, no Dexie — the Swift build
 * translates this file directly.
 *
 * The bias throughout is **median over mean**. These are personal datasets of a
 * few dozen points, where one twelve-hour day drags a mean somewhere no real day
 * ever was. A median describes a typical day; a mean describes an imaginary one.
 */

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/**
 * The middle value, or null for no data.
 *
 * Null rather than zero on purpose: "no data" and "measured zero" are different
 * claims, and rendering an absent median as 0 reads like failure when it only
 * means nothing has been recorded yet.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 1) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return sum(values) / values.length
}

export function maxOf(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values)
}

/** A share as a whole percentage. Null when there is nothing to divide by. */
export function percentOf(part: number, whole: number): number | null {
  if (whole === 0) return null
  return Math.round((part / whole) * 100)
}

/** Groups items by a derived key, preserving input order within each group. */
export function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const existing = groups.get(key)
    if (existing) existing.push(item)
    else groups.set(key, [item])
  }
  return groups
}

/** Rounds to a fixed number of decimals without exponent surprises. */
export function roundTo(value: number, decimals = 1): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
