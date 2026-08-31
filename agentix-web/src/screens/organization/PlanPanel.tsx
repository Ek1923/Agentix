import { Minus, Plus } from 'lucide-react'
import type { Membership, OrgPlan, Organization } from '../../core/db/types'
import { can } from '../../core/org/permissions'
import { PLANS, describeSeats, planSpec, seatUsage, seatsAllowed } from '../../core/org/seats'
import { feedback } from '../../ui/feedback'

interface PlanPanelProps {
  organization: Organization
  roster: readonly Membership[]
  actor: Membership
  onChangePlan: (plan: OrgPlan, seats: number) => void
}

/**
 * The plan, the seats, and what they cost — which is nothing, yet.
 *
 * These controls are real: the seat count they set is the one `canFillSeat`
 * enforces, so lowering it genuinely stops the next invitation. What they are not
 * is a purchase. Nothing here takes a payment, and the panel says so plainly
 * rather than dressing an admin setting up as a checkout — a button that looks
 * like it charges you and does not is worse than no button.
 */
export function PlanPanel({ organization, roster, actor, onChangePlan }: PlanPanelProps) {
  const usage = seatUsage(organization, roster)
  const editable = can(actor, 'manageBilling').ok
  const spec = planSpec(organization.plan)

  // Never below the seats already in use: a plan that says 3 while 5 people are in
  // it is a number nobody can act on.
  const floor = Math.max(1, usage.used)
  const ceiling = spec.maxSeats ?? 500

  function setSeats(next: number) {
    if (next < floor || next > ceiling) return
    if (!seatsAllowed(organization.plan, next)) return
    feedback('selection')
    onChangePlan(organization.plan, next)
  }

  function choose(plan: OrgPlan) {
    if (plan === organization.plan) return
    const max = planSpec(plan).maxSeats
    // Moving to a smaller plan cannot silently drop people, so the seat count
    // comes down only as far as the plan's ceiling and never below the roster.
    const seats = max === null ? organization.seats : Math.min(organization.seats, max)
    feedback('success')
    onChangePlan(plan, Math.max(seats, Math.min(floor, max ?? floor)))
  }

  return (
    <section className="card rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="display text-base text-ink">Plan</h2>
        <p className={`text-sm ${usage.over ? 'text-bad' : 'text-muted'}`}>
          {describeSeats(usage)}
          {usage.pending > 0 && ` · ${usage.pending} not accepted yet`}
        </p>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-line"
        role="img"
        aria-label={describeSeats(usage)}
      >
        <div
          className={`h-full rounded-full ${usage.over ? 'bg-bad' : 'bg-accent'}`}
          style={{ width: `${Math.min(100, (usage.used / Math.max(1, usage.licensed)) * 100)}%` }}
        />
      </div>

      <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const current = plan.id === organization.plan
          return (
            <button
              key={plan.id}
              type="button"
              disabled={!editable || current}
              aria-pressed={current}
              onClick={() => choose(plan.id)}
              className={`rounded-xl border p-3.5 text-left transition-colors ${
                current
                  ? 'border-accent bg-accent/5'
                  : editable
                    ? 'border-line hover:border-muted'
                    : 'border-line opacity-60'
              }`}
            >
              <span className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">{plan.label}</span>
                {current && <span className="eyebrow text-accent">Current</span>}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted">{plan.summary}</span>
            </button>
          )
        })}
      </div>

      {editable && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Seats</p>
            <p className="mt-0.5 text-xs text-muted">
              {spec.maxSeats === null
                ? 'No ceiling on Enterprise.'
                : `Up to ${spec.maxSeats} on ${spec.label}.`}{' '}
              Cannot go below the {usage.used} in use.
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="One seat fewer"
              disabled={organization.seats <= floor}
              onClick={() => setSeats(organization.seats - 1)}
              className="flex size-9 items-center justify-center rounded-xl border border-line text-ink transition-colors hover:border-muted disabled:opacity-40"
            >
              <Minus className="size-4" aria-hidden />
            </button>
            <span className="min-w-12 text-center text-lg font-medium tabular-nums text-ink">
              {organization.seats}
            </span>
            <button
              type="button"
              aria-label="One seat more"
              disabled={organization.seats >= ceiling}
              onClick={() => setSeats(organization.seats + 1)}
              className="flex size-9 items-center justify-center rounded-xl border border-line text-ink transition-colors hover:border-muted disabled:opacity-40"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted">
        {editable
          ? 'Nothing here takes a payment. These settings record what your plan is and enforce the seat limit inside the app; connecting them to an actual subscription is still to do.'
          : 'Only the owner can change the plan.'}
      </p>
    </section>
  )
}
