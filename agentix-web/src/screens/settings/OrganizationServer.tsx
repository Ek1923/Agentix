import { motion } from 'framer-motion'
import { Building2, Loader2, RadioTower, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { checkIdentityHealth, UNKNOWN_HEALTH, type HealthResult } from '../../core/sync/health'
import { readIdentityConfig, saveIdentityUrl } from '../../core/sync/identity'
import { Button } from '../../ui/components/Button'
import { Card } from '../../ui/components/Card'
import { feedback } from '../../ui/feedback'
import { transition } from '../../ui/tokens'

const DOT: Record<HealthResult['status'], string> = {
  online: 'bg-ok',
  unauthorized: 'bg-warn',
  offline: 'bg-bad',
  unknown: 'bg-muted',
}

/**
 * Where the organisation's own server is, and whether it is answering.
 *
 * This is the coordination half of the split: the roster, the organisations and
 * the shared pool of people live on a box the organisation runs, while everything
 * a person writes stays in their own project. Both are set here rather than in one
 * place each, because "which servers is this device talking to" is one question.
 *
 * The address is not a secret — it is a public hostname that answers to anyone who
 * asks, and what protects the data behind it is the token and the policies on the
 * box. That is why it can sit in a text field, and why the check below needs
 * nobody to be signed in: it reads the realm's public discovery document, which is
 * the smallest thing that proves the whole chain is up — tunnel, container, realm.
 */
export function OrganizationServer() {
  const configured = readIdentityConfig()
  const [draft, setDraft] = useState(configured?.url ?? '')
  const [saved, setSaved] = useState(configured?.url ?? null)
  const [health, setHealth] = useState<HealthResult>(UNKNOWN_HEALTH)
  const [checking, setChecking] = useState(false)

  const trimmed = draft.trim()
  const changed = trimmed !== (saved ?? '')

  function save() {
    saveIdentityUrl(trimmed === '' ? null : trimmed)
    const now = readIdentityConfig()

    // Rejected rather than stored: the field says https, and a token travelling
    // over plain http is the one mistake worth refusing outright.
    if (trimmed !== '' && now === null) {
      setHealth({
        status: 'offline',
        latencyMs: null,
        at: new Date().toISOString(),
        message: 'That is not an https address this device will talk to.',
      })
      feedback('warning')
      return
    }

    setSaved(now?.url ?? null)
    setDraft(now?.url ?? '')
    setHealth(UNKNOWN_HEALTH)
    feedback('light')
  }

  async function check() {
    const config = readIdentityConfig()
    if (config === null) return

    setChecking(true)
    try {
      const result = await checkIdentityHealth(config)
      setHealth(result)
      feedback(result.status === 'online' ? 'success' : 'warning')
    } finally {
      setChecking(false)
    }
  }

  return (
    <Card
      title="Organisation server"
      description={saved ?? 'Not connected — this device is the personal app.'}
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-muted">
            <Building2 className="size-4" aria-hidden />
          </span>
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted">
            Your organisation runs this one. It holds the roster and the shared pool
            of people — names and labels, nothing anybody wrote. Your tasks, notes
            and time stay in your own project, so if they ever leak they leak from
            somewhere you control.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="identity-url" className="eyebrow">
            Address
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="identity-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="https://id.example.com"
              className="min-w-[14rem] flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
            />
            <Button onClick={save} disabled={!changed}>
              Save
            </Button>
            {saved !== null && (
              <Button
                variant="ghost"
                aria-label="Forget this server"
                onClick={() => {
                  saveIdentityUrl(null)
                  setSaved(null)
                  setDraft('')
                  setHealth(UNKNOWN_HEALTH)
                  feedback('warning')
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                Forget
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={() => void check()} disabled={saved === null || checking}>
            {checking ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RadioTower className="size-4" aria-hidden />
            )}
            {checking ? 'Checking…' : 'Check now'}
          </Button>

          <motion.span
            key={health.message}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transition.tap}
            role="status"
            className="flex items-center gap-2 text-sm text-muted"
          >
            <span className={`size-2 shrink-0 rounded-full ${DOT[health.status]}`} aria-hidden />
            {health.message}
          </motion.span>
        </div>

        <p className="border-t border-line pt-3 text-xs leading-relaxed text-muted">
          Set for everyone at once with the <code>VITE_IDENTITY_URL</code> build
          variable; what you type here overrides it on this device only, which is how
          a server still being stood up gets tested without a rebuild.
        </p>
      </div>
    </Card>
  )
}
