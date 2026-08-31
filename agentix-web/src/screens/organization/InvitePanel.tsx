import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import type { Membership, OrgRole, Organization } from '../../core/db/types'
import { validateInvite } from '../../core/org/members'
import { can, roleDescription, roleLabel } from '../../core/org/permissions'
import { canFillSeat } from '../../core/org/seats'
import { Button } from '../../ui/components/Button'
import { feedback } from '../../ui/feedback'

interface InvitePanelProps {
  organization: Organization
  roster: readonly Membership[]
  actor: Membership
  onInvite: (email: string, role: OrgRole) => Promise<void>
}

const INVITABLE: OrgRole[] = ['member', 'admin']

/**
 * Adding someone, which is the thing an admin comes here to do.
 *
 * The address and the seat are checked separately and reported separately. They
 * are different problems with different fixes — "they are already here" is not
 * solved by buying a seat, and "no seats left" is not solved by retyping the
 * address — and collapsing them into one message would send someone to the wrong
 * one.
 */
export function InvitePanel({ organization, roster, actor, onInvite }: InvitePanelProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('member')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  const allowed = can(actor, 'invite')
  const seat = canFillSeat(organization, roster)
  // Only judged once something has been typed, so the field does not open in red.
  const address = email.trim() === '' ? null : validateInvite(roster, email)

  const blocker = !allowed.ok ? allowed : !seat.ok ? seat : null
  const ready = allowed.ok && seat.ok && address !== null && address.ok && !busy

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    try {
      await onInvite(email, role)
      setSent(email.trim().toLowerCase())
      setEmail('')
      feedback('success')
    } finally {
      setBusy(false)
    }
  }

  if (!allowed.ok) return null

  return (
    <form onSubmit={submit} className="card rounded-2xl p-5">
      <div className="flex items-center gap-2.5">
        <UserPlus className="size-4 text-muted" aria-hidden />
        <h2 className="display text-base text-ink">Add someone</h2>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <label htmlFor="inviteEmail" className="sr-only">
            Email address
          </label>
          <input
            id="inviteEmail"
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setSent(null)
            }}
            placeholder="them@example.com"
            disabled={!seat.ok}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted disabled:opacity-50"
          />
        </div>

        <div className="flex gap-2">
          {INVITABLE.map((option) => (
            <button
              key={option}
              type="button"
              disabled={!seat.ok}
              aria-pressed={role === option}
              title={roleDescription(option)}
              onClick={() => {
                feedback('selection')
                setRole(option)
              }}
              className={`rounded-xl border px-3 py-2.5 text-sm transition-colors disabled:opacity-50 ${
                role === option
                  ? 'border-accent text-accent'
                  : 'border-line text-muted hover:border-muted'
              }`}
            >
              {roleLabel(option)}
            </button>
          ))}

          <Button disabled={!ready} type="submit">
            {busy ? 'Sending…' : 'Invite'}
          </Button>
        </div>
      </div>

      {/*
        Confirmation first, then whatever is now standing in the way.

        Inviting the last person makes both true at once, and showing the seat
        warning above the confirmation reads as an error the invitation caused.
        Causal order — it worked, and here is where that leaves you — reads as
        what actually happened.
      */}
      {sent !== null && (
        <p role="status" className="mt-3 text-sm text-ok">
          Invited {sent}. They join by signing in with that address.
        </p>
      )}

      {blocker !== null && (
        <p role="status" className="mt-3 text-sm text-muted">
          {blocker.reason}
        </p>
      )}

      {blocker === null && address !== null && !address.ok && (
        <p role="status" className="mt-3 text-sm text-bad">
          {address.reason}
        </p>
      )}
    </form>
  )
}
