import { describe, expect, it } from 'vitest'
import type { Membership, MembershipStatus, OrgRole } from '../db/types'
import {
  describeAccess,
  displayName,
  effectivePluginIds,
  findByEmail,
  initials,
  mayOpenPlugin,
  normaliseEmail,
  searchRoster,
  sortRoster,
  statusLabel,
  validateInvite,
} from './members'

function member(overrides: Partial<Membership> & { id: string }): Membership {
  return {
    orgId: 'org-1',
    userId: null,
    email: `${overrides.id}@example.com`,
    name: null,
    role: 'member' as OrgRole,
    status: 'active' as MembershipStatus,
    allowedPluginIds: null,
    invitedAt: '2026-08-01T00:00:00.000Z',
    joinedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

const INSTALLED = ['task-manager', 'agenda', 'note-taker', 'backtest']

describe('normaliseEmail', () => {
  it('trims and lowercases, so an invite and a sign-in match', () => {
    expect(normaliseEmail('  Ada@Example.COM ')).toBe('ada@example.com')
  })
})

describe('findByEmail', () => {
  const roster = [member({ id: 'a', email: 'ada@example.com' })]

  it('matches regardless of how the address was typed', () => {
    expect(findByEmail(roster, ' ADA@example.com ')?.id).toBe('a')
  })

  it('ignores removed rows, so a seat can be refilled', () => {
    const removed = [
      member({ id: 'a', email: 'ada@example.com', deletedAt: '2026-08-02T00:00:00.000Z' }),
    ]
    expect(findByEmail(removed, 'ada@example.com')).toBeUndefined()
  })
})

describe('validateInvite', () => {
  const roster = [
    member({ id: 'a', email: 'ada@example.com' }),
    member({ id: 'b', email: 'bob@example.com', status: 'invited' }),
  ]

  it('refuses an empty address', () => {
    expect(validateInvite(roster, '   ').ok).toBe(false)
  })

  it('refuses something that is not an address', () => {
    const verdict = validateInvite(roster, 'not-an-email')
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/email address/i)
  })

  it('tells an existing member apart from a pending invitation', () => {
    const already = validateInvite(roster, 'ada@example.com')
    expect(already.ok === false && already.reason).toMatch(/already in this organisation/i)

    const pending = validateInvite(roster, 'bob@example.com')
    expect(pending.ok === false && pending.reason).toMatch(/already been invited/i)
  })

  it('accepts a fresh address', () => {
    expect(validateInvite(roster, 'carol@example.com').ok).toBe(true)
  })
})

describe('displayName and initials', () => {
  it('falls back to the address before a name is set', () => {
    expect(displayName(member({ id: 'a', email: 'ada@example.com' }))).toBe('ada@example.com')
    expect(displayName(member({ id: 'a', name: 'Ada Lovelace' }))).toBe('Ada Lovelace')
  })

  it('treats a blank name as no name', () => {
    expect(displayName(member({ id: 'a', name: '   ' }))).toBe('a@example.com')
  })

  it('builds initials from a name, or from the address when there is none', () => {
    expect(initials(member({ id: 'a', name: 'Ada Lovelace' }))).toBe('AL')
    expect(initials(member({ id: 'a', email: 'ada.lovelace@example.com' }))).toBe('AL')
  })
})

describe('sortRoster', () => {
  it('puts owners first, then admins, then members', () => {
    const roster = [
      member({ id: 'm', role: 'member' }),
      member({ id: 'o', role: 'owner' }),
      member({ id: 'a', role: 'admin' }),
    ]
    expect(sortRoster(roster).map((m) => m.id)).toEqual(['o', 'a', 'm'])
  })

  it('puts joined people above pending ones at the same level', () => {
    const roster = [
      member({ id: 'pending', status: 'invited', email: 'a@example.com' }),
      member({ id: 'joined', status: 'active', email: 'z@example.com' }),
    ]
    expect(sortRoster(roster).map((m) => m.id)).toEqual(['joined', 'pending'])
  })

  it('does not mutate the input', () => {
    const roster = [member({ id: 'm', role: 'member' }), member({ id: 'o', role: 'owner' })]
    sortRoster(roster)
    expect(roster.map((m) => m.id)).toEqual(['m', 'o'])
  })
})

describe('searchRoster', () => {
  const roster = [
    member({ id: 'a', email: 'ada@example.com', name: 'Ada Lovelace' }),
    member({ id: 'b', email: 'bob@other.com', name: null }),
  ]

  it('returns everyone for an empty query', () => {
    expect(searchRoster(roster, '  ').length).toBe(2)
  })

  it('matches on name and on address', () => {
    expect(searchRoster(roster, 'lovelace').map((m) => m.id)).toEqual(['a'])
    expect(searchRoster(roster, 'other.com').map((m) => m.id)).toEqual(['b'])
  })
})

describe('effectivePluginIds', () => {
  it('gives an unrestricted member everything installed', () => {
    expect(effectivePluginIds({ allowedPluginIds: null, status: 'active' }, INSTALLED)).toEqual(
      INSTALLED,
    )
  })

  it('gives a suspended member nothing, whatever their allowance says', () => {
    expect(effectivePluginIds({ allowedPluginIds: null, status: 'suspended' }, INSTALLED)).toEqual(
      [],
    )
  })

  it('drops ids for plugins that are not installed', () => {
    const allowed = ['agenda', 'long-gone']
    expect(effectivePluginIds({ allowedPluginIds: allowed, status: 'active' }, INSTALLED)).toEqual([
      'agenda',
    ])
  })

  it('keeps the installed order rather than the allowance order', () => {
    const allowed = ['backtest', 'task-manager']
    expect(effectivePluginIds({ allowedPluginIds: allowed, status: 'active' }, INSTALLED)).toEqual([
      'task-manager',
      'backtest',
    ])
  })
})

describe('mayOpenPlugin', () => {
  it('answers per plugin', () => {
    const m = { allowedPluginIds: ['agenda'], status: 'active' as MembershipStatus }
    expect(mayOpenPlugin(m, INSTALLED, 'agenda')).toBe(true)
    expect(mayOpenPlugin(m, INSTALLED, 'backtest')).toBe(false)
  })
})

describe('describeAccess', () => {
  it('says all, some, none or suspended', () => {
    expect(describeAccess({ allowedPluginIds: null, status: 'active' }, INSTALLED)).toBe('All tools')
    expect(describeAccess({ allowedPluginIds: ['agenda'], status: 'active' }, INSTALLED)).toBe(
      '1 of 4 tools',
    )
    expect(describeAccess({ allowedPluginIds: [], status: 'active' }, INSTALLED)).toBe('No tools')
    expect(describeAccess({ allowedPluginIds: null, status: 'suspended' }, INSTALLED)).toBe(
      'Suspended',
    )
  })
})

describe('statusLabel', () => {
  it('names every status', () => {
    expect(statusLabel('active')).toBe('Active')
    expect(statusLabel('invited')).toBe('Invited')
    expect(statusLabel('suspended')).toBe('Suspended')
  })
})
