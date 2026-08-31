import { Check } from 'lucide-react'
import { useState } from 'react'
import type { Membership, OrgRole } from '../../core/db/types'
import { describeAccess, displayName, initials, statusLabel } from '../../core/org/members'
import {
  canRemove,
  canSetPluginAccess,
  canSetRole,
  canSuspend,
  roleDescription,
  roleLabel,
  type Verdict,
} from '../../core/org/permissions'
import { Menu } from '../../ui/components/Menu'
import { feedback } from '../../ui/feedback'

const ROLES: OrgRole[] = ['owner', 'admin', 'member']

interface MemberRowProps {
  member: Membership
  actor: Membership
  roster: readonly Membership[]
  installedPluginIds: readonly string[]
  pluginNames: ReadonlyMap<string, string>
  onSetRole: (member: Membership, role: OrgRole) => void
  onSetAccess: (member: Membership, allowed: string[] | null) => void
  onSuspend: (member: Membership, suspended: boolean) => void
  onRemove: (member: Membership) => void
}

/**
 * One person on the roster.
 *
 * Every control asks `core/org/permissions` whether it is allowed and renders the
 * refusal as the control's tooltip when it is not. That is the whole reason those
 * functions return a sentence instead of a boolean: a greyed-out button that
 * cannot say why is the thing this codebase refuses to ship.
 */
export function MemberRow({
  member,
  actor,
  roster,
  installedPluginIds,
  pluginNames,
  onSetRole,
  onSetAccess,
  onSuspend,
  onRemove,
}: MemberRowProps) {
  const [accessOpen, setAccessOpen] = useState(false)

  const isSelf = member.id === actor.id
  const suspendVerdict = canSuspend(actor, member, roster)
  const removeVerdict = canRemove(actor, member, roster)
  const accessVerdict = canSetPluginAccess(actor, member)

  return (
    <li className="card rounded-2xl px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-raised text-xs font-semibold text-muted"
        >
          {initials(member)}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            {displayName(member)}
            {isSelf && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
          </p>
          {/*
            Status is not repeated here — the chip on the right already carries it,
            and saying "Invited" twice on one row reads as two different facts.
            The address only appears when the line above is showing a name.
          */}
          <p className="truncate text-xs text-muted">
            {member.name === null
              ? describeAccess(member, installedPluginIds)
              : `${member.email} · ${describeAccess(member, installedPluginIds)}`}
          </p>
        </div>

        {member.status !== 'active' && (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
              member.status === 'invited'
                ? 'border-line text-muted'
                : 'border-bad/40 text-bad'
            }`}
          >
            {statusLabel(member.status)}
          </span>
        )}

        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
          {roleLabel(member.role)}
        </span>

        <Menu
          label={`Manage ${displayName(member)}`}
          groups={[
            {
              label: 'Role',
              items: ROLES.map((role) => {
                const verdict = canSetRole(actor, member, role, roster)
                return {
                  id: `role-${role}`,
                  label: `Make ${roleLabel(role).toLowerCase()}`,
                  selected: member.role === role,
                  disabled: !verdict.ok,
                  hint: verdict.ok ? roleDescription(role) : refusalOf(verdict),
                  onSelect: () => {
                    feedback('selection')
                    onSetRole(member, role)
                  },
                }
              }),
            },
            {
              items: [
                {
                  id: 'access',
                  label: 'Change what they can open',
                  disabled: !accessVerdict.ok,
                  hint: accessVerdict.ok ? undefined : refusalOf(accessVerdict),
                  onSelect: () => {
                    feedback('light')
                    setAccessOpen((open) => !open)
                  },
                },
                member.status === 'suspended'
                  ? {
                      id: 'restore',
                      label: 'Restore access',
                      disabled: !accessVerdict.ok,
                      hint: accessVerdict.ok ? undefined : refusalOf(accessVerdict),
                      onSelect: () => {
                        feedback('success')
                        onSuspend(member, false)
                      },
                    }
                  : {
                      id: 'suspend',
                      label: 'Suspend',
                      disabled: !suspendVerdict.ok,
                      hint: suspendVerdict.ok
                        ? 'Keeps the seat and the history, removes access.'
                        : refusalOf(suspendVerdict),
                      onSelect: () => {
                        feedback('warning')
                        onSuspend(member, true)
                      },
                    },
              ],
            },
            {
              items: [
                {
                  id: 'remove',
                  label: isSelf ? 'Leave organisation' : 'Remove',
                  danger: true,
                  disabled: !removeVerdict.ok,
                  hint: removeVerdict.ok ? 'Frees the seat.' : refusalOf(removeVerdict),
                  onSelect: () => {
                    feedback('warning')
                    onRemove(member)
                  },
                },
              ],
            },
          ]}
        />
      </div>

      {accessOpen && accessVerdict.ok && (
        <AccessPicker
          member={member}
          installedPluginIds={installedPluginIds}
          pluginNames={pluginNames}
          onChange={(allowed) => onSetAccess(member, allowed)}
        />
      )}
    </li>
  )
}

function refusalOf(verdict: Verdict): string | undefined {
  return verdict.ok ? undefined : verdict.reason
}

/**
 * Which tools this person may open.
 *
 * "Everything" is a state of its own rather than "all boxes ticked", because the
 * two behave differently the day a tenth plugin is installed: everything means
 * they get it, and nine ticked boxes means they do not.
 */
function AccessPicker({
  member,
  installedPluginIds,
  pluginNames,
  onChange,
}: {
  member: Membership
  installedPluginIds: readonly string[]
  pluginNames: ReadonlyMap<string, string>
  onChange: (allowed: string[] | null) => void
}) {
  const unrestricted = member.allowedPluginIds === null
  const allowed = new Set(member.allowedPluginIds ?? [])

  function toggle(id: string) {
    feedback('selection')
    const next = new Set(unrestricted ? installedPluginIds : allowed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  return (
    <div className="mt-3.5 border-t border-line pt-3.5">
      <button
        type="button"
        onClick={() => {
          feedback('selection')
          onChange(unrestricted ? [] : null)
        }}
        className="flex w-full items-center justify-between rounded-xl bg-raised px-3 py-2 text-left"
      >
        <span className="text-sm text-ink">Everything, including anything added later</span>
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${
            unrestricted ? 'border-accent bg-accent text-surface' : 'border-line'
          }`}
        >
          {unrestricted && <Check className="size-3" aria-hidden />}
        </span>
      </button>

      <div className="mt-2 flex flex-wrap gap-2">
        {installedPluginIds.map((id) => {
          const on = unrestricted || allowed.has(id)
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              aria-pressed={on}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                on ? 'border-accent text-accent' : 'border-line text-muted hover:border-muted'
              }`}
            >
              {pluginNames.get(id) ?? id}
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-muted">
        This changes their menu, not their permissions. The code for every tool is
        already on their device — real enforcement is row-level security on the
        server.
      </p>
    </div>
  )
}
