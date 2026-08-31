import { describe, expect, it } from 'vitest'
import { SYNC_TABLES } from '../db/types'
import { BACKEND_OF, backendOf, isContentTable, tablesForBackend } from './backends'

describe('the backend split', () => {
  it('routes every syncable table, and only those', () => {
    // The map and the table list must agree: a table with no home would sync
    // nowhere, and a home with no table is a typo.
    expect(new Set(Object.keys(BACKEND_OF))).toEqual(new Set(SYNC_TABLES))
  })

  it('keeps identity and coordination on the org server', () => {
    // The light layer: who people are, and how the org is shaped.
    expect(backendOf('organizations')).toBe('identity')
    expect(backendOf('memberships')).toBe('identity')
    expect(backendOf('people')).toBe('identity')
  })

  it('keeps everything a person authors on their own project', () => {
    // The heavy, potentially sensitive content stays with its author.
    for (const table of ['tasks', 'notes', 'sessions', 'buckets', 'habits', 'habitLogs'] as const) {
      expect(backendOf(table)).toBe('data')
    }
  })

  it('never puts authored content on the org server', () => {
    // The liability boundary, asserted directly: the org server must not become
    // the place a note or a task title lives.
    for (const table of tablesForBackend('identity')) {
      expect(isContentTable(table)).toBe(false)
    }
  })

  it('derives each side’s table list from the one map', () => {
    const identity = tablesForBackend('identity')
    const data = tablesForBackend('data')

    // Together they are exactly the syncable tables, with nothing counted twice.
    expect([...identity, ...data].sort()).toEqual([...SYNC_TABLES].sort())
    expect(identity.some((t) => data.includes(t))).toBe(false)
  })
})
