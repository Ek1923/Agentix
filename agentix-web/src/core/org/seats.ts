import type { Membership, OrgPlan, Organization } from '../db/types'
import type { Verdict } from './permissions'

/**
 * Seats, and the one question a bill has to answer: how many am I paying for and
 * how many am I using?
 *
 * A seat is held by anyone still on the roster — invited, active or suspended.
 * Counting only active members would make the number drift from the invoice the
 * moment somebody was invited, and a seat count that disagrees with the bill is
 * worse than no seat count.
 */

export interface SeatUsage {
  /** Seats the plan pays for. */
  licensed: number
  /** Seats currently held. */
  used: number
  /** Never negative — an over-subscribed org reports 0 free, not -3. */
  free: number
  /** Held by someone who has not accepted yet. Shown separately because it is reversible. */
  pending: number
  over: boolean
}

/** Whether this row occupies a seat. Removed rows do not. */
export function holdsSeat(m: Membership): boolean {
  return m.deletedAt === null
}

export function seatUsage(org: Organization, roster: readonly Membership[]): SeatUsage {
  const held = roster.filter(holdsSeat)
  const used = held.length
  const pending = held.filter((m) => m.status === 'invited').length
  return {
    licensed: org.seats,
    used,
    free: Math.max(0, org.seats - used),
    pending,
    over: used > org.seats,
  }
}

/**
 * What each plan is for.
 *
 * `maxSeats` is the ceiling the plan itself imposes, separate from how many are
 * bought: a solo plan is one person by definition, and going beyond it is a plan
 * change rather than a quantity change.
 */
export interface PlanSpec {
  id: OrgPlan
  label: string
  /** null means no ceiling — enterprise is priced per agreement. */
  maxSeats: number | null
  summary: string
}

export const PLANS: readonly PlanSpec[] = [
  {
    id: 'solo',
    label: 'Solo',
    maxSeats: 1,
    summary: 'Just you. Everything the app does, on your own devices.',
  },
  {
    id: 'team',
    label: 'Team',
    maxSeats: 25,
    summary: 'Up to 25 people, shared access, one person administering it.',
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    maxSeats: null,
    summary: 'No seat ceiling, and a say in what gets built next.',
  },
]

export function planSpec(plan: OrgPlan): PlanSpec {
  // Falls back to solo rather than throwing: an unknown plan from a newer build
  // should degrade to the smallest one, not break the screen that would fix it.
  return PLANS.find((p) => p.id === plan) ?? PLANS[0]!
}

export function planLabel(plan: OrgPlan): string {
  return planSpec(plan).label
}

/** Whether a seat count is buyable on this plan. */
export function seatsAllowed(plan: OrgPlan, seats: number): boolean {
  if (!Number.isInteger(seats) || seats < 1) return false
  const max = planSpec(plan).maxSeats
  return max === null || seats <= max
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/**
 * Whether there is room for one more person.
 *
 * Refused rather than silently over-filling, because the alternative is an
 * invitation that succeeds now and becomes a billing surprise later.
 */
export function canFillSeat(org: Organization, roster: readonly Membership[]): Verdict {
  const usage = seatUsage(org, roster)
  if (usage.free > 0) return { ok: true }

  // Keyed on the plan, not on the number. A Team plan that happens to be sized at
  // one seat is not a Solo plan, and telling its owner to "move to Team" when they
  // are already on it sends them somewhere that does not exist.
  if (org.plan === 'solo') {
    return { ok: false, reason: 'A solo plan is one seat. Move to Team to invite anyone.' }
  }
  return {
    ok: false,
    reason: `All ${usage.licensed} ${plural(usage.licensed, 'seat is', 'seats are')} taken. Add seats or remove someone first.`,
  }
}

/** "3 of 10 seats used", or the honest version when it is over. */
export function describeSeats(usage: SeatUsage): string {
  if (usage.over) {
    const seats = plural(usage.licensed, 'seat', 'seats')
    const people = plural(usage.used, 'person', 'people')
    return `${usage.used} ${people} on ${usage.licensed} ${seats} — ${usage.used - usage.licensed} over`
  }
  return `${usage.used} of ${usage.licensed} ${plural(usage.licensed, 'seat', 'seats')} used`
}
