// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  accountLabel,
  accountsForProject,
  forgetAccount,
  forgetAllAccounts,
  listAccounts,
  normaliseAccountEmail,
  providerLabel,
  rememberAccount,
  removeAccount,
  sortAccounts,
  upsertAccount,
  type KnownAccount,
} from './accounts'
import type { Session } from './index'

function session(overrides: Partial<Session> = {}): Session {
  return {
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
    expiresAt: 4_000_000_000,
    userId: 'user-1',
    email: 'Ada@Example.com',
    ...overrides,
  }
}

function account(overrides: Partial<KnownAccount> & { id: string }): KnownAccount {
  return {
    email: `${overrides.id}@example.com`,
    provider: 'email',
    name: null,
    projectId: null,
    lastSeenAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('normaliseAccountEmail', () => {
  it('trims and lowercases', () => {
    expect(normaliseAccountEmail('  Ada@Example.COM ')).toBe('ada@example.com')
  })
})

describe('upsertAccount', () => {
  it('keys on the id, so changing an address keeps one row', () => {
    const first = account({ id: 'u1', email: 'old@example.com' })
    const renamed = account({ id: 'u1', email: 'new@example.com' })

    const list = upsertAccount(upsertAccount([], first), renamed)
    expect(list).toHaveLength(1)
    expect(list[0]!.email).toBe('new@example.com')
  })

  it('does not lose a name it already learned', () => {
    const named = account({ id: 'u1', name: 'Ada Lovelace' })
    const anonymous = account({ id: 'u1', name: null })

    const list = upsertAccount(upsertAccount([], named), anonymous)
    expect(list[0]!.name).toBe('Ada Lovelace')
  })

  it('does not mutate the list it was given', () => {
    const list = [account({ id: 'u1' })]
    upsertAccount(list, account({ id: 'u2' }))
    expect(list).toHaveLength(1)
  })
})

describe('sortAccounts and removeAccount', () => {
  it('puts the most recently used first', () => {
    const a = account({ id: 'a', lastSeenAt: '2026-08-01T00:00:00.000Z' })
    const b = account({ id: 'b', lastSeenAt: '2026-08-09T00:00:00.000Z' })
    expect(sortAccounts([a, b]).map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('removes by id', () => {
    expect(removeAccount([account({ id: 'a' })], 'a')).toEqual([])
  })
})

describe('accountsForProject', () => {
  const mine = account({ id: 'mine', projectId: 'https://a.supabase.co' })
  const theirs = account({ id: 'theirs', projectId: 'https://b.supabase.co' })
  const legacy = account({ id: 'legacy', projectId: null })

  it('offers only people who can sign in to the project in front of them', () => {
    const list = accountsForProject([mine, theirs], 'https://a.supabase.co')
    expect(list.map((a) => a.id)).toEqual(['mine'])
  })

  it('keeps entries recorded before projects were tracked', () => {
    // They are still probably yours; hiding them would silently lose shortcuts.
    const list = accountsForProject([theirs, legacy], 'https://a.supabase.co')
    expect(list.map((a) => a.id)).toContain('legacy')
  })

  it('shows everything when no project is selected', () => {
    expect(accountsForProject([mine, theirs], null)).toHaveLength(2)
  })
})

describe('labels', () => {
  it('prefers a name and falls back to the address', () => {
    expect(accountLabel(account({ id: 'a', name: 'Ada' }))).toBe('Ada')
    expect(accountLabel(account({ id: 'a', name: '  ' }))).toBe('a@example.com')
  })

  it('names each provider', () => {
    expect(providerLabel('google')).toBe('Google')
    expect(providerLabel('apple')).toBe('Apple')
    expect(providerLabel('email')).toBe('Email')
  })
})

describe('remembering a sign-in', () => {
  it('records the address, the provider and the project', () => {
    rememberAccount(session(), 'google', 'https://a.supabase.co')

    const [saved] = listAccounts()
    expect(saved?.email).toBe('ada@example.com')
    expect(saved?.provider).toBe('google')
    expect(saved?.projectId).toBe('https://a.supabase.co')
  })

  it('never stores a token', () => {
    // This list can only pre-fill a field. A list that also held tokens would be
    // a list worth stealing.
    rememberAccount(session(), 'email', null)

    const raw = localStorage.getItem('agentix-known-accounts') ?? ''
    expect(raw).not.toContain('access-token-value')
    expect(raw).not.toContain('refresh-token-value')

    const [saved] = listAccounts()
    expect(Object.keys(saved ?? {})).not.toContain('accessToken')
    expect(Object.keys(saved ?? {})).not.toContain('refreshToken')
  })

  it('signing in twice leaves one entry', () => {
    rememberAccount(session(), 'email', null)
    rememberAccount(session(), 'email', null)
    expect(listAccounts()).toHaveLength(1)
  })

  it('keeps separate people apart', () => {
    rememberAccount(session({ userId: 'u1', email: 'a@example.com' }), 'email', null)
    rememberAccount(session({ userId: 'u2', email: 'b@example.com' }), 'apple', null)
    expect(listAccounts()).toHaveLength(2)
  })
})

describe('forgetting', () => {
  it('removes one account and leaves the rest', () => {
    rememberAccount(session({ userId: 'u1', email: 'a@example.com' }), 'email', null)
    rememberAccount(session({ userId: 'u2', email: 'b@example.com' }), 'email', null)

    forgetAccount('u1')
    expect(listAccounts().map((a) => a.id)).toEqual(['u2'])
  })

  it('clears the lot, and the key with it', () => {
    rememberAccount(session(), 'email', null)
    forgetAllAccounts()

    expect(listAccounts()).toEqual([])
    expect(localStorage.getItem('agentix-known-accounts')).toBeNull()
  })
})

describe('a corrupted list', () => {
  it('reads as empty rather than throwing', () => {
    localStorage.setItem('agentix-known-accounts', 'not json')
    expect(listAccounts()).toEqual([])
  })

  it('drops entries that are not accounts', () => {
    localStorage.setItem('agentix-known-accounts', JSON.stringify([{ nope: 1 }, account({ id: 'a' })]))
    expect(listAccounts()).toHaveLength(1)
  })
})
