import { describe, expect, it } from 'vitest'
import type { Membership, OrgRole } from '../db/types'
import {
  activeOwners,
  can,
  canManage,
  canRemove,
  canSetPluginAccess,
  canSetRole,
  canSuspend,
  outranks,
  roleCan,
} from './permissions'

function member(overrides: Partial<Membership> & { id: string; role: OrgRole }): Membership {
  return {
    orgId: 'org-1',
    userId: `user-${overrides.id}`,
    email: `${overrides.id}@example.com`,
    name: null,
    status: 'active',
    allowedPluginIds: null,
    invitedAt: '2026-08-01T00:00:00.000Z',
    joinedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

const owner = member({ id: 'owner', role: 'owner' })
const owner2 = member({ id: 'owner2', role: 'owner' })
const admin = member({ id: 'admin', role: 'admin' })
const admin2 = member({ id: 'admin2', role: 'admin' })
const plain = member({ id: 'plain', role: 'member' })

describe('roleCan', () => {
  it('reserves billing and deletion for the owner', () => {
    expect(roleCan('owner', 'manageBilling')).toBe(true)
    expect(roleCan('admin', 'manageBilling')).toBe(false)
    expect(roleCan('owner', 'deleteOrg')).toBe(true)
    expect(roleCan('admin', 'deleteOrg')).toBe(false)
  })

  it('lets an admin run the team', () => {
    expect(roleCan('admin', 'invite')).toBe(true)
    expect(roleCan('admin', 'removeMember')).toBe(true)
    expect(roleCan('admin', 'setPluginAccess')).toBe(true)
  })

  it('gives a plain member nothing administrative', () => {
    expect(roleCan('member', 'invite')).toBe(false)
    expect(roleCan('member', 'removeMember')).toBe(false)
    expect(roleCan('member', 'setRole')).toBe(false)
  })
})

describe('outranks', () => {
  it('orders owner above admin above member', () => {
    expect(outranks('owner', 'admin')).toBe(true)
    expect(outranks('admin', 'member')).toBe(true)
    expect(outranks('admin', 'owner')).toBe(false)
    expect(outranks('admin', 'admin')).toBe(false)
  })
})

describe('can', () => {
  it('refuses anyone whose own membership is not active', () => {
    const suspended = member({ id: 'x', role: 'owner', status: 'suspended' })
    const verdict = can(suspended, 'invite')
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/not active/i)
  })

  it('explains a refusal rather than only refusing', () => {
    const verdict = can(plain, 'invite')
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason.length).toBeGreaterThan(0)
  })
})

describe('canManage', () => {
  it('always lets someone act on their own row, so leaving is possible', () => {
    expect(canManage(plain, plain).ok).toBe(true)
  })

  it('stops an admin reaching an owner', () => {
    const verdict = canManage(admin, owner)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/owner/i)
  })

  it('stops an admin reaching another admin', () => {
    expect(canManage(admin, admin2).ok).toBe(false)
  })

  it('lets an owner reach anyone', () => {
    expect(canManage(owner, admin).ok).toBe(true)
    expect(canManage(owner, owner2).ok).toBe(true)
  })

  it('refuses someone from another organisation', () => {
    const outsider = member({ id: 'out', role: 'member', orgId: 'org-2' })
    expect(canManage(owner, outsider).ok).toBe(false)
  })
})

describe('activeOwners', () => {
  it('counts only active, undeleted owners', () => {
    const roster = [
      owner,
      member({ id: 'o2', role: 'owner', status: 'suspended' }),
      member({ id: 'o3', role: 'owner', deletedAt: '2026-08-02T00:00:00.000Z' }),
      admin,
    ]
    expect(activeOwners(roster).map((m) => m.id)).toEqual(['owner'])
  })
})

describe('canRemove', () => {
  it('refuses removing the only owner', () => {
    const verdict = canRemove(owner, owner, [owner, admin, plain])
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/only owner/i)
  })

  it('allows an owner to leave once a second owner exists', () => {
    expect(canRemove(owner, owner, [owner, owner2]).ok).toBe(true)
  })

  it('lets a plain member leave without any admin right', () => {
    expect(canRemove(plain, plain, [owner, plain]).ok).toBe(true)
  })

  it('does not let a plain member remove anyone else', () => {
    expect(canRemove(plain, admin, [owner, admin, plain]).ok).toBe(false)
  })

  it('lets an admin remove a member', () => {
    expect(canRemove(admin, plain, [owner, admin, plain]).ok).toBe(true)
  })
})

describe('canSuspend', () => {
  it('refuses suspending yourself', () => {
    const verdict = canSuspend(owner, owner, [owner, owner2])
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/yourself/i)
  })

  it('refuses suspending the only owner', () => {
    expect(canSuspend(owner2, owner, [owner, owner2]).ok).toBe(true)
    expect(canSuspend(admin, owner, [owner, admin]).ok).toBe(false)
  })
})

describe('canSetRole', () => {
  it('refuses a no-op', () => {
    const verdict = canSetRole(owner, admin, 'admin', [owner, admin])
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/already/i)
  })

  it('stops an admin handing out ownership', () => {
    const verdict = canSetRole(admin, plain, 'owner', [owner, admin, plain])
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/only an owner/i)
  })

  it('lets an owner promote anyone', () => {
    expect(canSetRole(owner, plain, 'owner', [owner, plain]).ok).toBe(true)
    expect(canSetRole(owner, plain, 'admin', [owner, plain]).ok).toBe(true)
  })

  it('refuses demoting the last owner, including yourself', () => {
    const verdict = canSetRole(owner, owner, 'admin', [owner, admin])
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/only owner/i)
  })

  it('allows self-demotion once a second owner exists', () => {
    expect(canSetRole(owner, owner, 'admin', [owner, owner2]).ok).toBe(true)
  })
})

describe('canSetPluginAccess', () => {
  it('follows the same reach rules as everything else', () => {
    expect(canSetPluginAccess(owner, plain).ok).toBe(true)
    expect(canSetPluginAccess(admin, plain).ok).toBe(true)
    expect(canSetPluginAccess(admin, owner).ok).toBe(false)
    expect(canSetPluginAccess(plain, plain).ok).toBe(false)
  })
})
