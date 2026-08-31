// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  activeProject,
  forgetProject,
  labelFor,
  listProjects,
  normaliseProjectUrl,
  pickActive,
  projectIdFor,
  removeProject,
  renameProject,
  saveProject,
  selectProject,
  sortProjects,
  upsertProject,
  type SavedProject,
} from './projects'
import { readStoredConfig } from './supabase'

function project(overrides: Partial<SavedProject> & { url: string }): SavedProject {
  return {
    id: projectIdFor(overrides.url),
    label: labelFor(overrides.url),
    anonKey: 'k'.repeat(40),
    addedAt: '2026-08-01T00:00:00.000Z',
    lastUsedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('normaliseProjectUrl', () => {
  it('settles the spellings that mean one project', () => {
    expect(normaliseProjectUrl('https://Abc.supabase.co/')).toBe('https://abc.supabase.co')
    expect(normaliseProjectUrl('  https://abc.supabase.co///  ')).toBe('https://abc.supabase.co')
  })
})

describe('labelFor', () => {
  it('names a project by its ref rather than the whole host', () => {
    expect(labelFor('https://abcdefg.supabase.co')).toBe('abcdefg')
  })

  it('falls back to the URL when it is not one', () => {
    expect(labelFor('not a url')).toBe('not a url')
  })
})

describe('upsertProject', () => {
  it('adds a project the list does not have', () => {
    const list = upsertProject([], project({ url: 'https://a.supabase.co' }))
    expect(list).toHaveLength(1)
  })

  it('updates rather than duplicating when the key is rotated', () => {
    const first = project({ url: 'https://a.supabase.co', anonKey: 'old-key-'.repeat(5) })
    const rotated = project({ url: 'https://a.supabase.co/', anonKey: 'new-key-'.repeat(5) })

    const list = upsertProject(upsertProject([], first), rotated)
    expect(list).toHaveLength(1)
    expect(list[0]!.anonKey).toBe(rotated.anonKey)
  })

  it('keeps the day it was first added', () => {
    const first = project({ url: 'https://a.supabase.co', addedAt: '2026-01-01T00:00:00.000Z' })
    const again = project({ url: 'https://a.supabase.co', addedAt: '2026-09-09T00:00:00.000Z' })

    const list = upsertProject(upsertProject([], first), again)
    expect(list[0]!.addedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('does not mutate the list it was given', () => {
    const list: SavedProject[] = [project({ url: 'https://a.supabase.co' })]
    upsertProject(list, project({ url: 'https://b.supabase.co' }))
    expect(list).toHaveLength(1)
  })
})

describe('pickActive', () => {
  const a = project({ url: 'https://a.supabase.co', lastUsedAt: '2026-08-01T00:00:00.000Z' })
  const b = project({ url: 'https://b.supabase.co', lastUsedAt: '2026-08-09T00:00:00.000Z' })

  it('returns null only for an empty list', () => {
    expect(pickActive([], null)).toBeNull()
  })

  it('honours the selection when it still exists', () => {
    expect(pickActive([a, b], a.id)?.id).toBe(a.id)
  })

  it('falls back to the most recently used rather than to nothing', () => {
    // Forgetting the active project should hand the device to its next best
    // option, not disconnect it.
    expect(pickActive([a, b], 'gone')?.id).toBe(b.id)
  })
})

describe('sortProjects and removeProject', () => {
  it('puts the most recently used first', () => {
    const a = project({ url: 'https://a.supabase.co', lastUsedAt: '2026-08-01T00:00:00.000Z' })
    const b = project({ url: 'https://b.supabase.co', lastUsedAt: '2026-08-09T00:00:00.000Z' })
    expect(sortProjects([a, b]).map((p) => p.id)).toEqual([b.id, a.id])
  })

  it('removes by id', () => {
    const a = project({ url: 'https://a.supabase.co' })
    expect(removeProject([a], a.id)).toEqual([])
  })
})

describe('saving and switching', () => {
  it('saves a project and makes it live', () => {
    const saved = saveProject('https://a.supabase.co', 'k'.repeat(40))

    expect(listProjects()).toHaveLength(1)
    expect(activeProject()?.id).toBe(saved.id)
    expect(readStoredConfig()).toEqual({ url: 'https://a.supabase.co', anonKey: 'k'.repeat(40) })
  })

  it('keeps several projects and switches between them', () => {
    const a = saveProject('https://a.supabase.co', 'a'.repeat(40))
    const b = saveProject('https://b.supabase.co', 'b'.repeat(40))

    expect(listProjects()).toHaveLength(2)
    expect(activeProject()?.id).toBe(b.id)

    selectProject(a.id)
    expect(activeProject()?.id).toBe(a.id)
    expect(readStoredConfig()?.anonKey).toBe('a'.repeat(40))
  })

  it('ignores a switch to a project it does not have', () => {
    saveProject('https://a.supabase.co', 'a'.repeat(40))
    expect(selectProject('https://nowhere.supabase.co')).toBeNull()
  })

  it('renames without touching the connection', () => {
    const a = saveProject('https://a.supabase.co', 'a'.repeat(40))
    renameProject(a.id, '  Production  ')

    expect(listProjects()[0]!.label).toBe('Production')
    expect(readStoredConfig()?.anonKey).toBe('a'.repeat(40))
  })

  it('falls back to another project when the live one is forgotten', () => {
    const a = saveProject('https://a.supabase.co', 'a'.repeat(40))
    const b = saveProject('https://b.supabase.co', 'b'.repeat(40))

    forgetProject(b.id)
    expect(listProjects()).toHaveLength(1)
    expect(activeProject()?.id).toBe(a.id)
  })

  it('disconnects cleanly when the last project is forgotten', () => {
    const a = saveProject('https://a.supabase.co', 'a'.repeat(40))
    forgetProject(a.id)

    expect(listProjects()).toEqual([])
    expect(activeProject()).toBeNull()
    expect(readStoredConfig()).toBeNull()
  })
})

describe('the old single-config key', () => {
  it('is adopted into the list rather than lost', () => {
    // A device that connected before the list existed must not appear empty.
    localStorage.setItem(
      'agentix-supabase',
      JSON.stringify({ url: 'https://legacy.supabase.co', anonKey: 'L'.repeat(40) }),
    )

    const list = listProjects()
    expect(list).toHaveLength(1)
    expect(list[0]!.url).toBe('https://legacy.supabase.co')
    expect(readStoredConfig()?.anonKey).toBe('L'.repeat(40))
  })

  it('is cleared once adopted, so the migration does not run forever', () => {
    localStorage.setItem(
      'agentix-supabase',
      JSON.stringify({ url: 'https://legacy.supabase.co', anonKey: 'L'.repeat(40) }),
    )

    listProjects()
    expect(localStorage.getItem('agentix-supabase')).toBeNull()
    expect(listProjects()).toHaveLength(1)
  })

  it('ignores a malformed leftover instead of throwing', () => {
    localStorage.setItem('agentix-supabase', 'not json')
    expect(listProjects()).toEqual([])
  })
})

describe('a corrupted list', () => {
  it('reads as empty rather than breaking the screen that would fix it', () => {
    localStorage.setItem('agentix-projects', '{ not an array')
    expect(listProjects()).toEqual([])
  })

  it('drops entries that are not projects', () => {
    localStorage.setItem('agentix-projects', JSON.stringify([{ nonsense: true }, project({ url: 'https://a.supabase.co' })]))
    expect(listProjects()).toHaveLength(1)
  })
})
