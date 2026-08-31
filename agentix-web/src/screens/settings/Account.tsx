import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Check, LogIn, LogOut, RefreshCw, ServerCog } from 'lucide-react'
import { useState } from 'react'
import { currentSession } from '../../core/auth'
import {
  accountLabel,
  accountsForProject,
  forgetAccount,
  listAccounts,
  providerLabel,
  renameAccount,
  type KnownAccount,
} from '../../core/auth/accounts'
import { useAuth } from '../../core/auth/store'
import { queries } from '../../core/db/queries'
import { localStorageCursor, runSync } from '../../core/sync/engine'
import { activeProject } from '../../core/sync/projects'
import {
  createSupabaseTransport,
  isSyncConfigured,
  readSupabaseConfig,
} from '../../core/sync/supabase'
import { Button } from '../../ui/components/Button'
import { Card } from '../../ui/components/Card'
import { Menu } from '../../ui/components/Menu'
import { feedback } from '../../ui/feedback'
import { transition } from '../../ui/tokens'

type Status = { ok: boolean; message: string } | null

/**
 * The account, the accounts this device knows, and syncing — one card.
 *
 * These were two cards for a while and it showed: signed out, both of them
 * offered a "Sign in" button, which reads as two different doors to the same
 * room. One card, one way in.
 *
 * There is still no sign-in form here. That lives on its own screen, because two
 * forms for one action is two places for the rules to drift apart.
 */
export function Account({ onSignIn }: { onSignIn: () => void }) {
  const session = useAuth((s) => s.session)
  const adopt = useAuth((s) => s.adopt)
  const endSession = useAuth((s) => s.signOut)

  const configured = isSyncConfigured()
  const projectId = activeProject()?.id ?? null

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const [accounts, setAccounts] = useState(() => accountsForProject(listAccounts(), projectId))
  const reload = () => setAccounts(accountsForProject(listAccounts(), projectId))

  // Live, so the pending count drops the moment a sync clears the queue.
  const pending = useLiveQuery(async () => (await queries.listOutbox()).length, [], 0)

  async function sync() {
    setBusy(true)
    setStatus(null)
    try {
      const active = await currentSession()
      const config = readSupabaseConfig()
      if (active === null || config === null) {
        adopt(active)
        setStatus({ ok: false, message: 'Sign in again to keep syncing.' })
        return
      }

      const transport = createSupabaseTransport({
        config,
        accessToken: active.accessToken,
        userId: active.userId,
      })
      const result = await runSync(queries, transport, localStorageCursor())

      adopt(active)
      setStatus(result)
      feedback(result.ok ? 'success' : 'warning')
    } finally {
      setBusy(false)
    }
  }

  const roster =
    accounts.length === 0 ? null : (
      <div className="flex flex-col gap-2">
        <p className="eyebrow">On this device</p>
        <ul className="flex flex-col gap-2">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              current={session?.userId === account.id}
              onRename={(name) => {
                renameAccount(account.id, name)
                reload()
              }}
              onForget={() => {
                forgetAccount(account.id)
                reload()
                feedback('warning')
              }}
            />
          ))}
        </ul>
      </div>
    )

  if (session === null) {
    return (
      <Card title="Account" description="Not signed in">
        <div className="flex flex-col gap-5">
          <p className="text-sm leading-relaxed text-muted">
            Agentix works without an account, and this is what that means: everything
            you write stays on this device.{' '}
            {pending === 0
              ? 'Nothing is waiting to go anywhere.'
              : `${pending} change${pending === 1 ? '' : 's'} are recorded here and will sync once you sign in.`}
          </p>

          <div>
            <Button onClick={onSignIn}>
              <LogIn className="size-4" aria-hidden />
              Sign in
            </Button>
          </div>

          {roster}

          <p className="border-t border-line pt-3 text-xs leading-relaxed text-muted">
            An account adds two things and nothing else: syncing between your own
            devices, and organisations you share with other people.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <Card title="Account" description={session.email}>
      <div className="flex flex-col gap-5">
        {configured ? (
          <p className="text-sm text-muted">
            {pending === 0
              ? 'Everything here has been sent.'
              : `${pending} change${pending === 1 ? '' : 's'} waiting to sync.`}
          </p>
        ) : (
          /*
            Signed in, but this device is no longer pointed anywhere — someone
            disconnected the project below. Work keeps saving locally and queues
            up; it just has nowhere to go until a project is set again.
          */
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-muted">
              <ServerCog className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">No project connected.</p>
              <p className="mt-0.5 text-xs text-muted">
                {pending} change{pending === 1 ? '' : 's'} are recorded on this device and
                waiting for a destination. Set a project below to start syncing again.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void sync()} disabled={busy || !configured}>
            <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            {busy ? 'Syncing…' : 'Sync now'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              endSession()
              setStatus(null)
              feedback('light')
            }}
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </Button>
          <Button variant="ghost" onClick={onSignIn}>
            <LogIn className="size-4" aria-hidden />
            Switch account
          </Button>
        </div>

        {status && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transition.tap}
            role="status"
            className={`text-sm ${status.ok ? 'text-ok' : 'text-bad'}`}
          >
            {status.message}
          </motion.p>
        )}

        {roster}

        <p className="border-t border-line pt-3 text-xs leading-relaxed text-muted">
          Signing out leaves every task, note and session on this device. The list
          above holds addresses only — no passwords and no tokens — and never leaves
          this device.
        </p>
      </div>
    </Card>
  )
}

/**
 * One remembered account, with the two things you can do to it.
 *
 * Renaming is what makes a list of three addresses usable: "work" and "personal"
 * beat two strings that differ in the middle. Removing forgets a name here and
 * nothing else — it signs nobody out and deletes nothing on the server, which is
 * why it can sit in a menu without a confirmation step.
 */
function AccountRow({
  account,
  current,
  onRename,
  onForget,
}: {
  account: KnownAccount
  current: boolean
  onRename: (name: string) => void
  onForget: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(account.name ?? '')

  function commit() {
    onRename(draft)
    setRenaming(false)
    feedback('success')
  }

  return (
    <li className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5">
      {renaming ? (
        <>
          <label htmlFor={`rename-${account.id}`} className="sr-only">
            Name for {account.email}
          </label>
          <input
            id={`rename-${account.id}`}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setRenaming(false)
            }}
            placeholder={account.email}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-muted"
          />
          <button
            type="button"
            aria-label="Save name"
            onClick={commit}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-accent transition-colors hover:bg-accent/10"
          >
            <Check className="size-4" aria-hidden />
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">
              {accountLabel(account)}
              {current && (
                <span className="ml-1.5 text-xs font-normal text-muted">(signed in)</span>
              )}
            </span>
            <span className="block truncate text-xs text-muted">
              {providerLabel(account.provider)}
              {accountLabel(account) === account.email ? '' : ` · ${account.email}`}
            </span>
          </span>

          <Menu
            label={`Options for ${account.email}`}
            groups={[
              {
                items: [
                  {
                    id: 'rename',
                    label: account.name === null ? 'Give it a name' : 'Rename',
                    hint: 'Yours only, on this device.',
                    onSelect: () => {
                      setDraft(account.name ?? '')
                      setRenaming(true)
                      feedback('light')
                    },
                  },
                ],
              },
              {
                items: [
                  {
                    id: 'forget',
                    label: 'Remove from this device',
                    danger: true,
                    hint: current
                      ? 'Does not sign you out.'
                      : 'Forgets the address. Nothing on the server changes.',
                    onSelect: onForget,
                  },
                ],
              },
            ]}
          />
        </>
      )}
    </li>
  )
}
