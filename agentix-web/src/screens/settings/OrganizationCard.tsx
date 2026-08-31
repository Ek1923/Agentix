import { Building2, ChevronRight } from 'lucide-react'
import { describeAccess } from '../../core/org/members'
import { roleLabel } from '../../core/org/permissions'
import { describeSeats, planLabel, seatUsage } from '../../core/org/seats'
import { registry } from '../../core/plugin-host/registry'
import { useOrg } from '../../shell/useOrg'
import { Card } from '../../ui/components/Card'
import { feedback } from '../../ui/feedback'

/**
 * The way into the admin portal, and the only place it is advertised.
 *
 * Shows what you are rather than what you can do: someone who is a plain member
 * of somebody else's organisation still wants to know that, and still wants to
 * see what they have been given access to.
 */
export function OrganizationCard({ onOpen }: { onOpen: () => void }) {
  const { organization, roster, me, ready } = useOrg()
  if (!ready) return null

  const installed = registry.map((p) => p.manifest.id)

  const summary =
    organization === null
      ? 'Not set up. Create one to share Agentix with other people.'
      : me === null
        ? 'This device holds an organisation your account is not a member of.'
        : `${roleLabel(me.role)} · ${planLabel(organization.plan)} · ${describeSeats(
            seatUsage(organization, roster),
          )}`

  return (
    <Card>
      <button
        type="button"
        onClick={() => {
          feedback('light')
          onOpen()
        }}
        className="-m-1 flex w-full items-center gap-3 rounded-xl p-1 text-left"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-raised text-muted">
          <Building2 className="size-4" aria-hidden />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {organization?.name ?? 'Organisation'}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">{summary}</span>
        </span>

        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </button>

      {organization !== null && me !== null && me.allowedPluginIds !== null && (
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          Your access: {describeAccess(me, installed)}. An admin decides this.
        </p>
      )}
    </Card>
  )
}
