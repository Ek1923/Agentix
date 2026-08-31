import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../core/auth/store'
import { queries } from '../core/db/queries'
import type { Membership, Organization } from '../core/db/types'
import { normaliseEmail } from '../core/org/members'

/**
 * The organisation this device belongs to, and where the signed-in person sits
 * in it.
 *
 * Lives in `shell/` rather than `core/org/` on purpose: `core/` has no React
 * imports, because those files are the specification the Swift build translates.
 * A hook is the one thing that cannot cross that line, so the rules stay in
 * `core/org/` and the subscription to them stays here.
 *
 * Read through `useLiveQuery`, so accepting an invitation or changing a role
 * updates every screen watching it without anything having to refetch.
 */
export interface OrgState {
  organization: Organization | null
  roster: Membership[]
  /** The signed-in person's own membership, if they have one. */
  me: Membership | null
  /** False until both queries have answered once. */
  ready: boolean
}

/**
 * Matched on `userId` first and address second.
 *
 * The address is what an invitation is written against, and it is the only thing
 * that matches before someone has claimed theirs. Once claimed, `userId` is the
 * stronger match — two people can share an inbox, but not an account.
 */
function findMe(
  roster: readonly Membership[],
  session: { userId: string; email: string } | null,
): Membership | null {
  if (session === null) return null
  const byId = roster.find((m) => m.userId === session.userId)
  if (byId !== undefined) return byId

  const wanted = normaliseEmail(session.email)
  return roster.find((m) => m.email === wanted) ?? null
}

export function useOrg(): OrgState {
  const session = useAuth((s) => s.session)

  const organization = useLiveQuery(() => queries.currentOrganization(), [])
  const orgId = organization?.id ?? null

  const roster = useLiveQuery(
    () => (orgId === null ? Promise.resolve([]) : queries.listMemberships(orgId)),
    [orgId],
  )

  const ready = organization !== undefined && roster !== undefined

  return {
    organization: organization ?? null,
    roster: roster ?? [],
    me: findMe(roster ?? [], session),
    ready,
  }
}
