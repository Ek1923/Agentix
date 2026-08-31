import { beforeEach, describe, expect, it } from 'vitest'
import { canFillSeat } from '../org/seats'
import { validateInvite } from '../org/members'
import { db } from './db'
import { queries } from './queries'

beforeEach(async () => {
  await db.open()
  await Promise.all([db.organizations.clear(), db.memberships.clear(), db.syncOutbox.clear()])
})

async function makeOrg(seats = 5) {
  const created = await queries.createOrganization({
    name: 'Acme',
    plan: 'team',
    seats,
    ownerEmail: 'Owner@Example.com',
    ownerUserId: 'user-owner',
  })
  return created
}

describe('createOrganization', () => {
  it('writes the organisation and its owner together', async () => {
    const { organization, owner } = await makeOrg()

    expect(organization.name).toBe('Acme')
    expect(owner.orgId).toBe(organization.id)
    expect(owner.role).toBe('owner')
    expect(owner.status).toBe('active')
    expect(owner.joinedAt).not.toBeNull()
  })

  it('lowercases the owner address, so a later sign-in matches', async () => {
    const { owner } = await makeOrg()
    expect(owner.email).toBe('owner@example.com')
  })

  it('queues both rows for the next push', async () => {
    const { organization, owner } = await makeOrg()
    const queued = (await queries.listOutbox()).map((e) => e.id)

    expect(queued).toContain(`organizations:${organization.id}`)
    expect(queued).toContain(`memberships:${owner.id}`)
  })
})

describe('currentOrganization', () => {
  it('returns null rather than undefined when there is none', async () => {
    expect(await queries.currentOrganization()).toBeNull()
  })

  it('finds the one that exists', async () => {
    const { organization } = await makeOrg()
    expect((await queries.currentOrganization())?.id).toBe(organization.id)
  })

  it('ignores a deleted organisation', async () => {
    const { organization } = await makeOrg()
    await queries.deleteOrganization(organization.id)
    expect(await queries.currentOrganization()).toBeNull()
  })
})

describe('inviteMember', () => {
  it('creates a pending row holding a seat but no account', async () => {
    const { organization } = await makeOrg()
    const invited = await queries.inviteMember(organization.id, '  Ada@Example.com ')

    expect(invited.email).toBe('ada@example.com')
    expect(invited.status).toBe('invited')
    expect(invited.userId).toBeNull()
    expect(invited.joinedAt).toBeNull()
    expect(invited.allowedPluginIds).toBeNull()
  })

  it('fills seats until the plan runs out', async () => {
    const { organization } = await makeOrg(2)
    await queries.inviteMember(organization.id, 'ada@example.com')

    const roster = await queries.listMemberships(organization.id)
    expect(canFillSeat(organization, roster).ok).toBe(false)
  })

  it('frees the seat again when someone is removed', async () => {
    const { organization } = await makeOrg(2)
    const invited = await queries.inviteMember(organization.id, 'ada@example.com')
    await queries.removeMembership(invited.id)

    const roster = await queries.listMemberships(organization.id)
    expect(roster).toHaveLength(1)
    expect(canFillSeat(organization, roster).ok).toBe(true)
    // And the address can be used again, rather than colliding with the dead row.
    expect(validateInvite(roster, 'ada@example.com').ok).toBe(true)
  })
})

describe('claimMembership', () => {
  it('turns an invitation into an active member', async () => {
    const { organization } = await makeOrg()
    await queries.inviteMember(organization.id, 'ada@example.com')

    const claimed = await queries.claimMembership(
      organization.id,
      ' ADA@Example.com ',
      'user-ada',
      'Ada Lovelace',
    )

    expect(claimed?.status).toBe('active')
    expect(claimed?.userId).toBe('user-ada')
    expect(claimed?.name).toBe('Ada Lovelace')
    expect(claimed?.joinedAt).not.toBeNull()
  })

  it('returns undefined when there is nothing addressed to them', async () => {
    const { organization } = await makeOrg()
    expect(
      await queries.claimMembership(organization.id, 'stranger@example.com', 'user-x'),
    ).toBeUndefined()
  })

  it('does not reactivate someone who was suspended', async () => {
    const { organization } = await makeOrg()
    const invited = await queries.inviteMember(organization.id, 'ada@example.com')
    await queries.updateMembership(invited.id, { status: 'suspended' })

    const claimed = await queries.claimMembership(organization.id, 'ada@example.com', 'user-ada')
    expect(claimed?.status).toBe('suspended')
    // The account is still attached, so an admin restoring them does not have to
    // wait for a second sign-in.
    expect(claimed?.userId).toBe('user-ada')
  })

  it('does not overwrite a name the person already set', async () => {
    const { organization } = await makeOrg()
    const invited = await queries.inviteMember(organization.id, 'ada@example.com')
    await queries.updateMembership(invited.id, { name: 'Ada' })

    const claimed = await queries.claimMembership(
      organization.id,
      'ada@example.com',
      'user-ada',
      'Someone Else',
    )
    expect(claimed?.name).toBe('Ada')
  })

  it('is safe to run twice, which is what every app open does', async () => {
    const { organization } = await makeOrg()
    await queries.inviteMember(organization.id, 'ada@example.com')

    const first = await queries.claimMembership(organization.id, 'ada@example.com', 'user-ada')
    const second = await queries.claimMembership(organization.id, 'ada@example.com', 'user-ada')

    expect(second?.id).toBe(first?.id)
    expect(second?.joinedAt).toBe(first?.joinedAt)
    expect(await queries.listMemberships(organization.id)).toHaveLength(2)
  })
})

describe('deleteOrganization', () => {
  it('takes every membership with it, so no roster is left pointing at nothing', async () => {
    const { organization } = await makeOrg()
    await queries.inviteMember(organization.id, 'ada@example.com')

    await queries.deleteOrganization(organization.id)

    expect(await queries.listMemberships(organization.id)).toEqual([])
    expect(await queries.getOrganization(organization.id)).toBeUndefined()
  })

  it('queues the deletions, so other devices learn about them', async () => {
    const { organization, owner } = await makeOrg()
    await queries.clearOutbox((await queries.listOutbox()).map((e) => e.id))

    await queries.deleteOrganization(organization.id)
    const queued = (await queries.listOutbox()).map((e) => e.id)

    expect(queued).toContain(`organizations:${organization.id}`)
    expect(queued).toContain(`memberships:${owner.id}`)
  })
})

describe('updateMembership', () => {
  it('moves updatedAt forward, which is what drives sync', async () => {
    const { organization } = await makeOrg()
    const invited = await queries.inviteMember(organization.id, 'ada@example.com')

    await new Promise((resolve) => setTimeout(resolve, 2))
    await queries.updateMembership(invited.id, { role: 'admin' })

    const after = await queries.getMembership(invited.id)
    expect(after?.role).toBe('admin')
    expect(after?.updatedAt.localeCompare(invited.updatedAt)).toBe(1)
  })

  it('stores a narrowed plugin allowance, and null for everything', async () => {
    const { organization } = await makeOrg()
    const invited = await queries.inviteMember(organization.id, 'ada@example.com')

    await queries.updateMembership(invited.id, { allowedPluginIds: ['agenda'] })
    expect((await queries.getMembership(invited.id))?.allowedPluginIds).toEqual(['agenda'])

    await queries.updateMembership(invited.id, { allowedPluginIds: null })
    expect((await queries.getMembership(invited.id))?.allowedPluginIds).toBeNull()
  })
})
