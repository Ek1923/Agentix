import { describe, expect, it } from 'vitest'
import type { Note } from '../../../core/db/types'
import {
  canSummarise,
  countNotes,
  filterNotes,
  isSummaryStale,
  isValidNote,
  MIN_SUMMARY_CHARS,
  noteTitle,
  sortNotes,
  wordCount,
} from './notes'

function note(overrides: Partial<Note> & { id: string }): Note {
  const base: Note = {
    id: overrides.id,
    taskId: null,
    content: overrides.id,
    aiSummary: null,
    createdAt: '2026-08-27T09:00:00.000Z',
    updatedAt: '2026-08-27T09:00:00.000Z',
    deletedAt: null,
  }
  return Object.assign(base, overrides)
}

describe('isValidNote', () => {
  it('rejects blank and whitespace-only content', () => {
    expect(isValidNote('Something')).toBe(true)
    expect(isValidNote('')).toBe(false)
    expect(isValidNote('   \n  ')).toBe(false)
  })
})

describe('canSummarise', () => {
  it('refuses a note shorter than a summary would be', () => {
    // Guards a paid request on "bought milk".
    expect(canSummarise('Bought milk')).toBe(false)
    expect(canSummarise('x'.repeat(MIN_SUMMARY_CHARS - 1))).toBe(false)
  })

  it('allows a note long enough to be worth summarising', () => {
    expect(canSummarise('x'.repeat(MIN_SUMMARY_CHARS))).toBe(true)
  })

  it('measures the trimmed length, not the padding', () => {
    expect(canSummarise(`   ${'x'.repeat(MIN_SUMMARY_CHARS - 10)}   `)).toBe(false)
  })
})

describe('wordCount', () => {
  it('counts words, not characters', () => {
    expect(wordCount('one two three')).toBe(3)
    expect(wordCount('  spaced   out  ')).toBe(2)
    expect(wordCount('line\nbreaks\ncount')).toBe(3)
  })

  it('is zero for an empty note rather than one', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('   ')).toBe(0)
  })
})

describe('noteTitle', () => {
  it('uses the first line', () => {
    expect(noteTitle('Heading\nbody text')).toBe('Heading')
  })

  it('truncates a long first line with an ellipsis', () => {
    const title = noteTitle('x'.repeat(100), 20)
    expect(title).toHaveLength(21)
    expect(title.endsWith('…')).toBe(true)
  })

  it('handles a note with no line breaks', () => {
    expect(noteTitle('Just one line')).toBe('Just one line')
  })
})

describe('sortNotes', () => {
  it('puts the most recently edited first', () => {
    const sorted = sortNotes([
      note({ id: 'old', updatedAt: '2026-08-27T09:00:00.000Z' }),
      note({ id: 'new', updatedAt: '2026-08-27T11:00:00.000Z' }),
      note({ id: 'mid', updatedAt: '2026-08-27T10:00:00.000Z' }),
    ])
    expect(sorted.map((n) => n.id)).toEqual(['new', 'mid', 'old'])
  })

  it('does not mutate the array it was given', () => {
    const input = [note({ id: 'a' }), note({ id: 'b', updatedAt: '2026-08-27T11:00:00.000Z' })]
    sortNotes(input)
    expect(input.map((n) => n.id)).toEqual(['a', 'b'])
  })
})

describe('filterNotes', () => {
  const notes = [
    note({ id: '1', content: 'Meeting about the roadmap' }),
    note({ id: '2', content: 'Groceries', aiSummary: 'A list of roadmap items' }),
    note({ id: '3', content: 'Unrelated' }),
  ]

  it('matches content and summary, case-insensitively', () => {
    expect(filterNotes(notes, 'ROADMAP').map((n) => n.id)).toEqual(['1', '2'])
  })

  it('returns everything for a blank query', () => {
    expect(filterNotes(notes, '')).toHaveLength(3)
    expect(filterNotes(notes, '   ')).toHaveLength(3)
  })

  it('returns nothing when nothing matches', () => {
    expect(filterNotes(notes, 'zzz')).toEqual([])
  })
})

describe('isSummaryStale', () => {
  it('flags a summary written before the note was last edited', () => {
    // A summary of an older draft shown as current is worse than none.
    const edited = note({
      id: '1',
      aiSummary: 'old summary',
      updatedAt: '2026-08-27T12:00:00.000Z',
    })
    expect(isSummaryStale(edited, '2026-08-27T10:00:00.000Z')).toBe(true)
  })

  it('is false when there is no summary or no known summary time', () => {
    expect(isSummaryStale(note({ id: '1' }), '2026-08-27T10:00:00.000Z')).toBe(false)
    expect(isSummaryStale(note({ id: '2', aiSummary: 'x' }), undefined)).toBe(false)
  })
})

describe('countNotes', () => {
  it('counts totals, summaries and links', () => {
    expect(
      countNotes([
        note({ id: '1' }),
        note({ id: '2', aiSummary: 'done' }),
        note({ id: '3', taskId: 'task-1', aiSummary: 'done' }),
      ]),
    ).toEqual({ total: 3, summarised: 2, linked: 1 })
  })

  it('is all zeroes for no notes', () => {
    expect(countNotes([])).toEqual({ total: 0, summarised: 0, linked: 0 })
  })
})
