import { motion } from 'framer-motion'
import { ArrowLeft, Building2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../core/auth/store'
import { queries } from '../core/db/queries'
import type { OrgPlan, OrgRole } from '../core/db/types'
import { searchRoster, sortRoster } from '../core/org/members'
import { can } from '../core/org/permissions'
import { registry } from '../core/plugin-host/registry'
import { useOrg } from '../shell/useOrg'
import { Button } from '../ui/components/Button'
import { EmptyState } from '../ui/components/EmptyState'
import { feedback } from '../ui/feedback'
import { transition } from '../ui/tokens'
import { InvitePanel } from './organization/InvitePanel'
import { MemberRow } from './organization/MemberRow'
import { PlanPanel } from './organization/PlanPanel'

interface OrganizationProps {
  onBack: () => void
  onSignIn: () => void
}

/**
 * The admin portal, kept to the six things people actually open one for: who is
 * here, add someone, remove someone, change what they are, see the seats, and
 * decide what each person can open.
 *
 * Microsoft 365's admin centre does far more, and that is the point of not
 * copying it. Everything it has beyond this list exists to serve an organisation
 * with a compliance team; a team of nine opening it once a quarter needs the six.
 */
export function Organization({ onBack, onSignIn }: OrganizationProps) {
  const { organization, roster, me, ready } = useOrg()
  const [query, setQuery] = useState('')

  const installedPluginIds = useMemo(() => registry.map((p) => p.manifest.id), [])
  const pluginNames = useMemo(
    () => new Map(registry.map((p) => [p.manifest.id, p.manifest.name])),
    [],
  )

  const visible = useMemo(
    () => sortRoster(searchRoster(roster, query)),
    [roster, query],
  )

  return (
    <motion.main
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={transition.screen}
      className="mx-auto w-full max-w-4xl px-6 py-8"
    >
      <header className="flex items-center gap-4">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
        <h1 className="display text-lg text-ink">
          {organization?.name ?? 'Organisation'}
        </h1>
      </header>

      {/* Nothing renders until both queries have answered, so the create screen
          never flashes in front of an organisation that does exist. */}
      {!ready ? null : organization === null || me === null ? (
        <div className="mt-8">
          <CreateOrganization existing={organization !== null} onSignIn={onSignIn} />
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-6">
          <PlanPanel
            organization={organization}
            roster={roster}
            actor={me}
            onChangePlan={(plan, seats) => {
              void queries.updateOrganization(organization.id, { plan, seats })
            }}
          />

          <InvitePanel
            organization={organization}
            roster={roster}
            actor={me}
            onInvite={async (email, role) => {
              await queries.inviteMember(organization.id, email, role)
            }}
          />

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="display text-base text-ink">
                People <span className="text-muted">({roster.length})</span>
              </h2>

              {roster.length > 6 && (
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                    aria-hidden
                  />
                  <label htmlFor="rosterSearch" className="sr-only">
                    Search people
                  </label>
                  <input
                    id="rosterSearch"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search"
                    className="rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted"
                  />
                </div>
              )}
            </div>

            {visible.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
                Nobody matches “{query}”.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {visible.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    actor={me}
                    roster={roster}
                    installedPluginIds={installedPluginIds}
                    pluginNames={pluginNames}
                    onSetRole={(target, role: OrgRole) => {
                      void queries.updateMembership(target.id, { role })
                    }}
                    onSetAccess={(target, allowed) => {
                      void queries.updateMembership(target.id, { allowedPluginIds: allowed })
                    }}
                    onSuspend={(target, suspended) => {
                      void queries.updateMembership(target.id, {
                        status: suspended ? 'suspended' : 'active',
                      })
                    }}
                    onRemove={(target) => {
                      void queries.removeMembership(target.id)
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          {can(me, 'deleteOrg').ok && (
            <DangerZone
              name={organization.name}
              onDelete={() => {
                void queries.deleteOrganization(organization.id)
              }}
            />
          )}
        </div>
      )}
    </motion.main>
  )
}

/**
 * The way in when there is nothing yet.
 *
 * Creating one makes you its owner, which is why it cannot ask permission of
 * anybody. It starts on Solo with one seat: the smallest thing that is true, and
 * a plan change away from anything else.
 */
function CreateOrganization({
  existing,
  onSignIn,
}: {
  existing: boolean
  onSignIn: () => void
}) {
  const session = useAuth((s) => s.session)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const ready = name.trim().length >= 2 && session !== null && !busy

  async function create() {
    if (!ready || session === null) return
    setBusy(true)
    try {
      await queries.createOrganization({
        name,
        plan: 'solo' as OrgPlan,
        seats: 1,
        ownerEmail: session.email,
        ownerUserId: session.userId,
      })
      feedback('success')
    } finally {
      setBusy(false)
    }
  }

  /*
    An organisation is the one thing here that genuinely cannot work locally: it is
    a roster of other people, and it needs an identity to own it and an address to
    invite anyone to. So this is the one place that asks for an account — and says
    why, rather than presenting a form that would fail.
  */
  if (session === null) {
    return (
      <EmptyState
        icon={<Building2 className="size-6" aria-hidden />}
        title="Sign in to work with other people"
        body="An organisation needs an account: somebody has to own it, and an invitation has to be addressed to somewhere. Everything else in Agentix works without one."
        action={<Button onClick={onSignIn}>Sign in</Button>}
      />
    )
  }

  if (existing) {
    return (
      <EmptyState
        icon={<Building2 className="size-6" aria-hidden />}
        title="You are not in this organisation"
        body="This device holds an organisation your account is not a member of. Ask an admin to invite the address you signed in with."
      />
    )
  }

  return (
    <div className="card rounded-2xl p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-raised text-muted">
          <Building2 className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="display text-base text-ink">Work with other people</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            An organisation is how you share Agentix with a team: one roster, one
            plan, and one place to decide who can open what. Everything on this
            device stays exactly as it is until you invite somebody.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor="orgName" className="sr-only">
            Organisation name
          </label>
          <input
            id="orgName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme, or your own name"
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted"
          />
        </div>
        <Button disabled={!ready} onClick={create}>
          {busy ? 'Creating…' : 'Create organisation'}
        </Button>
      </div>

      <p className="mt-3 text-xs text-muted">
        You become its owner. It starts on Solo with one seat — change that any
        time from this screen.
      </p>
    </div>
  )
}

/** Deleting is the owner's alone, and asks twice because it takes everyone out. */
function DangerZone({ name, onDelete }: { name: string; onDelete: () => void }) {
  const [armed, setArmed] = useState(false)

  return (
    <section className="rounded-2xl border border-bad/30 p-5">
      <h2 className="display text-base text-ink">Delete this organisation</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Removes {name} and everyone in it. Nobody's tasks, notes or time are
        touched — those live on each person's own device and stay there.
      </p>

      <div className="mt-4">
        {armed ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              onClick={() => {
                feedback('warning')
                onDelete()
              }}
            >
              Yes, delete {name}
            </Button>
            <Button variant="ghost" onClick={() => setArmed(false)}>
              Keep it
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setArmed(true)}>
            Delete organisation
          </Button>
        )}
      </div>
    </section>
  )
}
