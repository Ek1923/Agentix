import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Loader2, ServerCog, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  OAUTH_PROVIDERS,
  isValidEmail,
  isValidPassword,
  signInWithProvider,
  type OAuthProvider,
} from '../core/auth'
import {
  ASSUME_ALL,
  describeMissingProviders,
  fetchEnabledProviders,
  type EnabledProviders,
} from '../core/auth/providers'
import {
  accountLabel,
  accountsForProject,
  forgetAccount,
  listAccounts,
  notePendingProvider,
  providerLabel,
  rememberAccount,
} from '../core/auth/accounts'
import { useAuth } from '../core/auth/store'
import { activeProject } from '../core/sync/projects'
import { isValidProjectUrl, readSupabaseConfig, saveStoredConfig } from '../core/sync/supabase'
import { BrandMark } from '../ui/components/BrandMark'
import { Button } from '../ui/components/Button'
import { Logo } from '../ui/components/Logo'
import { feedback } from '../ui/feedback'
import { transition } from '../ui/tokens'

type Mode = 'in' | 'up'

/**
 * Signing in, which is optional.
 *
 * This was the gate once — nothing rendered until it was satisfied. That was the
 * wrong shape for an app whose whole claim is that your work stays on your own
 * device: it made a local database unreachable without a server, and put the
 * setting that would fix that behind the thing it was blocking.
 *
 * So it is a screen now, reached deliberately, and what it buys is sync and
 * organisations. Everything else works signed out.
 *
 * It still carries every route in on its own — the two identity providers, an
 * email account, and the project setup that makes those three possible — because
 * someone who came here wants to finish here.
 */
export function SignIn({
  notice,
  onBack,
  onSkip,
  onSignedIn,
}: {
  notice?: string | null
  /** Omitted when this is rendered as a destination with nowhere to go back to. */
  onBack?: () => void
  /**
   * Into the app without signing in.
   *
   * Shown instead of Back when the app opened straight onto this screen, where
   * there is no history to go back to and "Back" would leave the app entirely.
   */
  onSkip?: () => void
  onSignedIn?: () => void
}) {
  const signIn = useAuth((s) => s.signIn)
  const signUp = useAuth((s) => s.signUp)

  const [configured, setConfigured] = useState(() => readSupabaseConfig() !== null)
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'form' | OAuthProvider | null>(null)
  /*
    The accounts this device has seen, for the project it is pointed at.

    Held in state rather than read on every render because forgetting one has to
    redraw the list, and localStorage has no change event to subscribe to.
  */
  const [known, setKnown] = useState(() =>
    accountsForProject(listAccounts(), activeProject()?.id ?? null),
  )

  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(
    notice === undefined || notice === null ? null : { ok: false, message: notice },
  )

  /*
    Which identity providers the project has actually switched on.

    Asked rather than assumed, because a provider that is off answers the button
    with a raw `provider is not enabled` JSON page — after a full-page redirect,
    where nothing of the app is left running to catch it. All three are shown
    until the answer arrives, and if it never does they stay: a probe that failed
    must not be the reason somebody cannot sign in.
  */
  const [enabled, setEnabled] = useState<EnabledProviders>(ASSUME_ALL)

  useEffect(() => {
    const config = readSupabaseConfig()
    if (config === null) return

    let live = true
    void fetchEnabledProviders(config).then((result) => {
      if (live) setEnabled(result)
    })
    return () => {
      live = false
    }
  }, [configured])

  const offered = OAUTH_PROVIDERS.filter((p) => enabled.oauth.includes(p.id))
  const missing = describeMissingProviders(enabled)

  const valid = isValidEmail(email) && isValidPassword(password)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy !== null || !valid) return

    setBusy('form')
    setStatus(null)
    try {
      const result = await (mode === 'in' ? signIn : signUp)(email.trim(), password)
      // A sign-up that needs email confirmation succeeds without a session, and
      // saying so is the whole reason this message exists.
      if (result.session === undefined) setStatus(result)
      setPassword('')
      feedback(result.ok ? 'success' : 'warning')
      // Only leave on a real session. A sign-up awaiting confirmation stays put,
      // because its message is the only thing telling them to check their inbox.
      if (result.session !== undefined) {
        rememberAccount(result.session, 'email', activeProject()?.id ?? null)
        onSignedIn?.()
      }
    } finally {
      setBusy(null)
    }
  }

  function startProvider(provider: OAuthProvider) {
    setBusy(provider)
    feedback('light')
    // Noted before the browser leaves the page, so the account list can say which
    // provider it came back from.
    notePendingProvider(provider)
    if (!signInWithProvider(provider)) {
      setBusy(null)
      setStatus({ ok: false, message: 'Set up the sync server first.' })
    }
    // On success the browser leaves the page. `busy` stays set on purpose, so the
    // button reads as working during the redirect rather than snapping back.
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-12">
      <motion.main
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transition.screen}
        className="w-full max-w-sm"
      >
        {onBack !== undefined && (
          <button
            type="button"
            onClick={onBack}
            className="mb-6 flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </button>
        )}

        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-5">
            <Logo size={52} label="Agentix" />
          </span>
          <p className="eyebrow">Agentix</p>
          <h1 className="display mt-2 text-2xl text-ink">
            {mode === 'in' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {mode === 'in'
              ? 'Sign in once. After that Agentix keeps working offline.'
              : 'One account carries your work across every device you use.'}
          </p>
        </div>

        {configured ? (
          <div className="card rounded-2xl p-6">
            {/*
              Who has signed in here before.

              A shortcut, not a session: choosing one fills the address in and
              nothing more, because no token is kept for it. That is also why
              removing one is safe — it forgets a name, it does not sign anybody
              out or delete anything on the server.
            */}
            {known.length > 0 && mode === 'in' && (
              <div className="mb-5 flex flex-col gap-2">
                <p className="eyebrow">On this device</p>
                {known.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-2 rounded-xl border border-line bg-elevated pr-1"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setEmail(account.email)
                        feedback('selection')
                      }}
                      className="min-w-0 flex-1 px-3 py-2.5 text-left"
                    >
                      <span className="block truncate text-sm text-ink">
                        {accountLabel(account)}
                      </span>
                      <span className="block text-xs text-muted">
                        {providerLabel(account.provider)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Forget ${account.email} on this device`}
                      title="Forget on this device"
                      onClick={() => {
                        forgetAccount(account.id)
                        setKnown(accountsForProject(listAccounts(), activeProject()?.id ?? null))
                        feedback('warning')
                      }}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-bad/10 hover:text-bad"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              <AnimatePresence initial={false}>
                {offered.map((provider) => (
                  <motion.button
                    key={provider.id}
                    layout
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={transition.tap}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => startProvider(provider.id)}
                    className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-elevated px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === provider.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <BrandMark provider={provider.id} />
                    )}
                    Continue with {provider.label}
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>

            {missing !== null && (
              <motion.p
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={transition.tap}
                className="mt-3 text-xs leading-relaxed text-muted"
              >
                {missing}
              </motion.p>
            )}

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="eyebrow">{offered.length === 0 ? 'sign in' : 'or'}</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="signInEmail" className="text-xs font-medium text-muted">
                  Email
                </label>
                <input
                  id="signInEmail"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="signInPassword" className="text-xs font-medium text-muted">
                  Password
                </label>
                <input
                  id="signInPassword"
                  type="password"
                  autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink"
                />
                {mode === 'up' && password !== '' && !isValidPassword(password) && (
                  <p className="text-xs text-muted">At least six characters.</p>
                )}
              </div>

              <button
                type="submit"
                disabled={!valid || busy !== null}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-surface transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === 'form' ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <ArrowRight className="size-4" aria-hidden />
                )}
                {mode === 'in' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            {status !== null && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={transition.tap}
                role="status"
                className={`mt-4 text-sm ${status.ok ? 'text-ok' : 'text-bad'}`}
              >
                {status.message}
              </motion.p>
            )}

            <p className="mt-5 border-t border-line pt-4 text-center text-sm text-muted">
              {mode === 'in' ? 'No account yet? ' : 'Already have one? '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'in' ? 'up' : 'in')
                  setStatus(null)
                  feedback('selection')
                }}
                className="font-medium text-accent hover:underline"
              >
                {mode === 'in' ? 'Create one' : 'Sign in'}
              </button>
            </p>
          </div>
        ) : (
          <FirstRunSetup onConnected={() => setConfigured(true)} />
        )}

        {onSkip !== undefined && (
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={onSkip}
              className="text-sm font-medium text-accent hover:underline"
            >
              Continue without an account
            </button>
          </div>
        )}

        <p className="mx-auto mt-6 max-w-xs text-center text-xs text-muted">
          Agentix works without an account. Signing in adds syncing between your
          devices and shared organisations — nothing else. API keys are never synced.
        </p>
      </motion.main>
    </div>
  )
}

/**
 * The way out of a first run.
 *
 * A device that has never been pointed at a Supabase project has nothing to sign
 * in against, and the Settings screen that would fix that sits behind this gate.
 * So the gate offers it directly. Both values here are publishable by design —
 * the anon key ships in every deployed bundle, and row-level security is what
 * actually separates one account's rows from another's.
 */
function FirstRunSetup({ onConnected }: { onConnected: () => void }) {
  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')

  const ready = isValidProjectUrl(url) && anonKey.trim().length > 20

  return (
    <div className="card rounded-2xl p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-muted">
          <ServerCog className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Connect your project first</p>
          <p className="mt-0.5 text-xs text-muted">
            Accounts live in your own Supabase project. Paste its URL and anon public key
            to enable sign-in on this device.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="gateUrl" className="text-xs font-medium text-muted">
            Project URL
          </label>
          <input
            id="gateUrl"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => {
              // People paste the bare host from the dashboard. Assume https rather
              // than refusing it.
              if (url.trim() !== '' && !/^https?:\/\//i.test(url.trim())) {
                setUrl(`https://${url.trim()}`)
              }
            }}
            placeholder="your-project.supabase.co"
            inputMode="url"
            spellCheck={false}
            className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="gateKey" className="text-xs font-medium text-muted">
            Anon key
          </label>
          <input
            id="gateKey"
            value={anonKey}
            onChange={(e) => setAnonKey(e.target.value)}
            placeholder="Paste the anon public key"
            spellCheck={false}
            className="measure rounded-xl border border-line bg-surface px-3 py-2.5 text-xs text-ink placeholder:font-sans placeholder:text-muted"
          />
          <p className="text-xs text-muted">
            The <strong className="text-ink">anon public</strong> key — never the service
            role key.
          </p>
        </div>

        <Button
          disabled={!ready}
          onClick={() => {
            saveStoredConfig({ url: url.trim(), anonKey: anonKey.trim() })
            feedback('success')
            onConnected()
          }}
        >
          Continue
        </Button>
      </div>
    </div>
  )
}
