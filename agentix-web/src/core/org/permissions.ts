import type { Membership, OrgRole } from '../db/types'

/**
 * Who may do what.
 *
 * Three roles, and a deliberate refusal to grow a fourth. Microsoft 365 ships
 * around forty admin roles because it has to serve organisations with a
 * compliance officer and a licensing desk. The teams this is for have neither:
 * somebody owns the account, somebody helps run it, and everybody else just
 * works. Anything finer is a permission nobody can remember the meaning of.
 *
 * Every check returns a reason when it refuses, because the UI's rule is that a
 * disabled control has to say why. A boolean cannot, and a caller inventing its
 * own message is how two screens end up disagreeing about the same rule.
 */

export type OrgAction =
  | 'invite'
  | 'removeMember'
  | 'suspendMember'
  | 'setRole'
  | 'setPluginAccess'
  | 'renameOrg'
  | 'manageBilling'
  | 'deleteOrg'

export type Verdict = { ok: true } | { ok: false; reason: string }

const ALLOW: Verdict = { ok: true }
const refuse = (reason: string): Verdict => ({ ok: false, reason })

/** Higher outranks lower. Used for "you cannot act on someone above you". */
const RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 }

export function outranks(a: OrgRole, b: OrgRole): boolean {
  return RANK[a] > RANK[b]
}

/** What a role may do at all, before any target is considered. */
const ROLE_ACTIONS: Record<OrgRole, ReadonlySet<OrgAction>> = {
  owner: new Set<OrgAction>([
    'invite',
    'removeMember',
    'suspendMember',
    'setRole',
    'setPluginAccess',
    'renameOrg',
    'manageBilling',
    'deleteOrg',
  ]),
  // An admin runs the team. Billing and deletion stay with the owner, because
  // both are irreversible in a way that costs money or loses data.
  admin: new Set<OrgAction>([
    'invite',
    'removeMember',
    'suspendMember',
    'setRole',
    'setPluginAccess',
    'renameOrg',
  ]),
  member: new Set<OrgAction>([]),
}

export function roleCan(role: OrgRole, action: OrgAction): boolean {
  return ROLE_ACTIONS[role].has(action)
}

const ACTION_LABEL: Record<OrgAction, string> = {
  invite: 'invite people',
  removeMember: 'remove people',
  suspendMember: 'suspend people',
  setRole: 'change roles',
  setPluginAccess: 'change what people can open',
  renameOrg: 'rename this organisation',
  manageBilling: 'change the plan',
  deleteOrg: 'delete this organisation',
}

/** The role gate on its own. Says nothing about any particular target. */
export function can(actor: Membership, action: OrgAction): Verdict {
  if (actor.status !== 'active') {
    return refuse('Your own membership is not active.')
  }
  if (!roleCan(actor.role, action)) {
    return refuse(`Only ${actor.role === 'member' ? 'an admin or owner' : 'the owner'} can ${ACTION_LABEL[action]}.`)
  }
  return ALLOW
}

/**
 * Whether `actor` may act on `target` at all.
 *
 * The rule is that you cannot reach above yourself, with one deliberate
 * exception: everyone can act on their own row, which is what makes leaving an
 * organisation possible without asking someone else to let you out.
 */
export function canManage(actor: Membership, target: Membership): Verdict {
  if (actor.id === target.id) return ALLOW
  if (actor.orgId !== target.orgId) return refuse('They are not in this organisation.')

  if (outranks(target.role, actor.role)) {
    return refuse(
      target.role === 'owner'
        ? 'Only an owner can change another owner.'
        : 'You cannot change someone above you.',
    )
  }

  /*
    Peers cannot act on each other — with owners as the deliberate exception.

    Owners are the top of the ladder, so refusing peer-on-peer there would mean a
    co-owner who has left the company can never be removed by anyone: nobody
    outranks them, and the person who could is gone. Admins have an owner above
    them to arbitrate, so they get the safer rule.
  */
  if (target.role === actor.role && actor.role !== 'owner') {
    return refuse('You cannot change someone at your own level.')
  }
  return ALLOW
}

/** Active owners, which is the count every "last owner" rule turns on. */
export function activeOwners(roster: readonly Membership[]): Membership[] {
  return roster.filter((m) => m.role === 'owner' && m.status === 'active' && m.deletedAt === null)
}

/**
 * Whether the last way into the account is about to be closed.
 *
 * An organisation with no active owner cannot be billed, renamed or recovered by
 * anyone inside it. Refusing the step that would cause it is the only protection
 * that does not require a support desk.
 */
function wouldStrandOrg(target: Membership, roster: readonly Membership[]): boolean {
  const owners = activeOwners(roster)
  return owners.length === 1 && owners[0]?.id === target.id
}

export function canRemove(
  actor: Membership,
  target: Membership,
  roster: readonly Membership[],
): Verdict {
  const gate = actor.id === target.id ? ALLOW : can(actor, 'removeMember')
  if (!gate.ok) return gate

  const reach = canManage(actor, target)
  if (!reach.ok) return reach

  if (wouldStrandOrg(target, roster)) {
    return refuse(
      actor.id === target.id
        ? 'You are the only owner. Make someone else an owner before you leave.'
        : 'This is the only owner. Make someone else an owner first.',
    )
  }
  return ALLOW
}

export function canSuspend(
  actor: Membership,
  target: Membership,
  roster: readonly Membership[],
): Verdict {
  const gate = can(actor, 'suspendMember')
  if (!gate.ok) return gate
  if (actor.id === target.id) return refuse('You cannot suspend yourself.')

  const reach = canManage(actor, target)
  if (!reach.ok) return reach

  if (wouldStrandOrg(target, roster)) {
    return refuse('This is the only owner. Make someone else an owner first.')
  }
  return ALLOW
}

export function canSetRole(
  actor: Membership,
  target: Membership,
  next: OrgRole,
  roster: readonly Membership[],
): Verdict {
  const gate = can(actor, 'setRole')
  if (!gate.ok) return gate

  if (target.role === next) return refuse(`They are already ${next === 'admin' ? 'an' : 'a'} ${next}.`)

  const reach = canManage(actor, target)
  if (!reach.ok) return reach

  // Only an owner hands out ownership. An admin promoting someone to owner would
  // be a way to gain a level they were never given.
  if (next === 'owner' && actor.role !== 'owner') {
    return refuse('Only an owner can make someone else an owner.')
  }

  if (target.role === 'owner' && next !== 'owner' && wouldStrandOrg(target, roster)) {
    return refuse(
      actor.id === target.id
        ? 'You are the only owner. Make someone else an owner first.'
        : 'This is the only owner. Make someone else an owner first.',
    )
  }
  return ALLOW
}

export function canSetPluginAccess(actor: Membership, target: Membership): Verdict {
  const gate = can(actor, 'setPluginAccess')
  if (!gate.ok) return gate
  return canManage(actor, target)
}

export function roleLabel(role: OrgRole): string {
  return role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Member'
}

/** One line saying what the role actually gets you, for the role picker. */
export function roleDescription(role: OrgRole): string {
  return role === 'owner'
    ? 'Everything, including the plan and deleting the organisation.'
    : role === 'admin'
      ? 'Manages people and access. Cannot change the plan.'
      : 'Uses the app. No administrative access.'
}
