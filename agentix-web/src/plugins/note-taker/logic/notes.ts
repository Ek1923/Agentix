import type { Note } from '../../../core/db/types'

/**
 * Note handling. Pure functions, no React, no Dexie — the Swift build translates
 * this file directly.
 */

/**
 * Below this, a summary would be longer than the note.
 *
 * Guarding here rather than in the UI means the check cannot be skipped by a
 * different call site, and it saves a paid request on "bought milk".
 */
export const MIN_SUMMARY_CHARS = 80

export function isValidNote(content: string): boolean {
  return content.trim().length > 0
}

/** Long enough that summarising it is worth a request. */
export function canSummarise(content: string): boolean {
  return content.trim().length >= MIN_SUMMARY_CHARS
}

export function wordCount(content: string): number {
  const trimmed = content.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

/**
 * The first line, trimmed to length — used as a heading when a note is collapsed.
 * Falls back to the whole thing when there are no line breaks.
 */
export function noteTitle(content: string, maxChars = 60): string {
  const firstLine = content.trim().split('\n')[0]?.trim() ?? ''
  if (firstLine.length <= maxChars) return firstLine
  return `${firstLine.slice(0, maxChars).trimEnd()}…`
}

/** Most recently edited first, so a note being worked on stays at the top. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function filterNotes(notes: Note[], query: string): Note[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return notes

  return notes.filter(
    (note) =>
      note.content.toLowerCase().includes(needle) ||
      (note.aiSummary?.toLowerCase().includes(needle) ?? false),
  )
}

/**
 * True when the note has changed since its summary was written.
 *
 * A summary of an older draft presented as current is worse than no summary, so
 * the UI marks these rather than quietly showing stale text.
 */
export function isSummaryStale(note: Note, summarisedAt: string | undefined): boolean {
  if (note.aiSummary === null) return false
  if (summarisedAt === undefined) return false
  return note.updatedAt > summarisedAt
}

export interface NoteCounts {
  total: number
  summarised: number
  linked: number
}

export function countNotes(notes: Note[]): NoteCounts {
  return {
    total: notes.length,
    summarised: notes.filter((n) => n.aiSummary !== null).length,
    linked: notes.filter((n) => n.taskId !== null).length,
  }
}
