import { isValidEmail } from '../auth'
import type { Membership, MembershipStatus, OrgRole } from '../db/types'
import type { Verdict } from './permissions'

/**
 * The roster: who is here, how they are addressed, and what they can open.
 *
 * Email is the identity throughout. It is what an invitation is sent to, what
 * matches a person to their membership when they first sign in, and what is shown
 * before anyone has set a name. `userId` arrives later and never replaces it.
 */

/**
 * One normalisation, in one place.
 *
 * An invitation to `Ada@Example.com ` and a sign-in as `ada@example.com` have to
 * land on the same membership, or the invitation is never claimed and the seat is
 * held by a row nobody can reach.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function findByEmail(
  roster: readonly Membership[],
  email: string,
): Membership | undefined {
  const wanted = normaliseEmail(email)
  return roster.find((m) => m.deletedAt === null && m.email === wanted)
}

/**
 * Whether this address can be invited right now.
 *
 * Seat availability is deliberately not checked here — that is `canFillSeat`, and
 * keeping them apart means the screen can explain "already invited" and "no seats"
 * as the different problems they are.
 */
export function validateInvite(roster: readonly Membership[], email: string): Verdict {
  const wanted = normaliseEmail(email)
  if (wanted === '') return { ok: false, reason: 'Enter an email address.' }
  if (!isValidEmail(wanted)) return { ok: false, reason: 'That does not look like an email address.' }

  const existing = findByEmail(roster, wanted)
  if (existing !== undefined) {
    return {
      ok: false,
      reason:
        existing.status === 'invited'
          ? 'They have already been invited.'
          : 'They are already in this organisation.',
    }
  }
  return { ok: true }
}

/** What to call someone. Their name if they have set one, their address if not. */
export function displayName(m: Membership): string {
  const name = m.name?.trim() ?? ''
  return name === '' ? m.email : name
}

/** Two letters for an avatar, from the name if there is one and the address if not. */
export function initials(m: Membership): string {
  const source = displayName(m)
  const parts = source.split(/[\s@._-]+/).filter((p) => p !== '')
  const letters = parts.length >= 2
    ? `${parts[0]![0]!}${parts[1]![0]!}`
    : source.slice(0, 2)
  return letters.toUpperCase()
}

const ROLE_ORDER: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2 }
const STATUS_ORDER: Record<MembershipStatus, number> = { active: 0, invited: 1, suspended: 2 }

/**
 * Owners first, then admins, then everyone else — and inside each, the people who
 * have actually joined before the ones who have not.
 *
 * Sorted by email last rather than by name, because a name can be empty and an
 * email never is. A list that reshuffles when someone fills in their profile is a
 * list you cannot keep your place in.
 */
export function sortRoster(roster: readonly Membership[]): Membership[] {
  return [...roster].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.email.localeCompare(b.email),
  )
}

/** Case-insensitive match on name and email, for the roster search box. */
export function searchRoster(roster: readonly Membership[], query: string): Membership[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...roster]
  return roster.filter(
    (m) => m.email.includes(q) || (m.name ?? '').toLowerCase().includes(q),
  )
}

/**
 * Which plugins this membership may open.
 *
 * `null` means all of them, and stays the default: a new member should see the
 * whole app, not an empty menu somebody has to remember to fill. Narrowing it is
 * a deliberate act by an admin.
 *
 * Unknown ids are dropped rather than kept. A plugin that was uninstalled should
 * not linger in someone's allowance and silently come back if it is reinstalled.
 */
export function effectivePluginIds(
  m: Pick<Membership, 'allowedPluginIds' | 'status'>,
  installed: readonly string[],
): string[] {
  if (m.status !== 'active') return []
  if (m.allowedPluginIds === null) return [...installed]
  const allowed = new Set(m.allowedPluginIds)
  return installed.filter((id) => allowed.has(id))
}

export function mayOpenPlugin(
  m: Pick<Membership, 'allowedPluginIds' | 'status'>,
  installed: readonly string[],
  pluginId: string,
): boolean {
  return effectivePluginIds(m, installed).includes(pluginId)
}

/** "All tools", or "4 of 9" — what the member row shows under the name. */
export function describeAccess(
  m: Pick<Membership, 'allowedPluginIds' | 'status'>,
  installed: readonly string[],
): string {
  if (m.status === 'suspended') return 'Suspended'
  if (m.allowedPluginIds === null) return 'All tools'
  const count = effectivePluginIds(m, installed).length
  return count === 0 ? 'No tools' : `${count} of ${installed.length} tools`
}

export function statusLabel(status: MembershipStatus): string {
  return status === 'active' ? 'Active' : status === 'invited' ? 'Invited' : 'Suspended'
}
