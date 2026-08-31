import { describe, expect, it } from 'vitest'
import type { Membership, MembershipStatus, OrgPlan, Organization } from '../db/types'
import {
  PLANS,
  canFillSeat,
  describeSeats,
  holdsSeat,
  planLabel,
  planSpec,
  seatUsage,
  seatsAllowed,
} from './seats'

function org(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    name: 'Acme',
    plan: 'team',
    seats: 5,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function member(id: string, status: MembershipStatus = 'active', deletedAt: string | null = null): Membership {
  return {
    id,
    orgId: 'org-1',
    userId: null,
    email: `${id}@example.com`,
    name: null,
    role: 'member',
    status,
    allowedPluginIds: null,
    invitedAt: '2026-08-01T00:00:00.000Z',
    joinedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt,
    ...{},
  }
}

describe('holdsSeat', () => {
  it('counts invited and suspended, not removed', () => {
    expect(holdsSeat(member('a', 'active'))).toBe(true)
    expect(holdsSeat(member('b', 'invited'))).toBe(true)
    // A suspended account is still being paid for, so it still holds its seat.
    expect(holdsSeat(member('c', 'suspended'))).toBe(true)
    expect(holdsSeat(member('d', 'active', '2026-08-02T00:00:00.000Z'))).toBe(false)
  })
})

describe('seatUsage', () => {
  it('reports what is used, free and pending', () => {
    const usage = seatUsage(org({ seats: 5 }), [
      member('a', 'active'),
      member('b', 'invited'),
      member('c', 'invited'),
      member('gone', 'active', '2026-08-02T00:00:00.000Z'),
    ])
    expect(usage).toEqual({ licensed: 5, used: 3, free: 2, pending: 2, over: false })
  })

  it('never reports negative free seats', () => {
    const usage = seatUsage(org({ seats: 1 }), [member('a'), member('b'), member('c')])
    expect(usage.free).toBe(0)
    expect(usage.over).toBe(true)
    expect(usage.used).toBe(3)
  })
})

describe('seatsAllowed', () => {
  it('holds a solo plan to one seat', () => {
    expect(seatsAllowed('solo', 1)).toBe(true)
    expect(seatsAllowed('solo', 2)).toBe(false)
  })

  it('caps team and leaves enterprise open', () => {
    expect(seatsAllowed('team', 25)).toBe(true)
    expect(seatsAllowed('team', 26)).toBe(false)
    expect(seatsAllowed('enterprise', 5000)).toBe(true)
  })

  it('rejects nonsense counts', () => {
    expect(seatsAllowed('team', 0)).toBe(false)
    expect(seatsAllowed('team', -1)).toBe(false)
    expect(seatsAllowed('team', 2.5)).toBe(false)
  })
})

describe('canFillSeat', () => {
  it('allows an invite while a seat is free', () => {
    expect(canFillSeat(org({ seats: 3 }), [member('a')]).ok).toBe(true)
  })

  it('refuses when full, and says what to do about it', () => {
    const verdict = canFillSeat(org({ seats: 2 }), [member('a'), member('b')])
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/seats are taken/i)
  })

  it('does not call a one-seat Team plan a solo plan', () => {
    // Keyed on the plan rather than the count: telling someone already on Team to
    // "move to Team" sends them nowhere.
    const verdict = canFillSeat(org({ plan: 'team', seats: 1 }), [member('a')])
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/All 1 seat is taken/i)
    expect(verdict.ok === false && verdict.reason).not.toMatch(/solo/i)
  })

  it('gives a solo plan its own explanation', () => {
    const verdict = canFillSeat(org({ plan: 'solo', seats: 1 }), [member('a')])
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/solo plan/i)
  })
})

describe('planSpec', () => {
  it('falls back to the smallest plan rather than throwing', () => {
    expect(planSpec('nonsense' as OrgPlan).id).toBe('solo')
  })

  it('labels every plan it ships', () => {
    for (const plan of PLANS) expect(planLabel(plan.id)).toBe(plan.label)
  })
})

describe('describeSeats', () => {
  it('reads normally when inside the plan', () => {
    expect(describeSeats(seatUsage(org({ seats: 10 }), [member('a'), member('b')]))).toBe(
      '2 of 10 seats used',
    )
  })

  it('keeps the grammar right at one', () => {
    expect(describeSeats(seatUsage(org({ seats: 1 }), [member('a')]))).toBe('1 of 1 seat used')
  })

  it('says plainly when it is over, rather than hiding it', () => {
    const usage = seatUsage(org({ seats: 1 }), [member('a'), member('b'), member('c')])
    expect(describeSeats(usage)).toBe('3 people on 1 seat — 2 over')
  })
})
