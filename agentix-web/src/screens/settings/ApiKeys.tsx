import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { providerList, providers, testConnection, type TestResult } from '../../core/ai'
import type { ProviderId } from '../../core/ai/providers/types'
import { deleteKey, getKey, setKey } from '../../core/ai/secure-store'
import { useSettings } from '../../core/settings/store'
import { Button } from '../../ui/components/Button'
import { Card } from '../../ui/components/Card'
import { Select } from '../../ui/components/Select'
import { transition } from '../../ui/tokens'

/** Shows enough to recognise a key, never enough to use one. */
function maskKey(key: string): string {
  return `••••••••${key.slice(-4)}`
}

export function ApiKeys() {
  const activeProvider = useSettings((s) => s.activeProvider)
  const setActiveProvider = useSettings((s) => s.setActiveProvider)
  const modelByProvider = useSettings((s) => s.modelByProvider)
  const setModel = useSettings((s) => s.setModel)

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const provider = providers[activeProvider]
  const model = modelByProvider[activeProvider] || (provider.models[0] ?? '')

  const savedKey = useLiveQuery(() => getKey(activeProvider), [activeProvider], null)

  function switchProvider(id: string) {
    setActiveProvider(id as ProviderId)
    // Clearing here is what keeps providers separate: a key typed for one provider
    // can never be saved against another by switching the dropdown mid-edit.
    setDraft('')
    setResult(null)
  }

  async function handleSave() {
    const key = draft.trim()
    if (!key) return

    if (!provider.keyPattern.test(key)) {
      setResult({ ok: false, message: `That does not look like a ${provider.label} key.` })
      return
    }

    await setKey(activeProvider, key)
    setDraft('')
    setResult({ ok: true, message: 'Key saved on this device.' })
  }

  async function handleDelete() {
    await deleteKey(activeProvider)
    setDraft('')
    setResult({ ok: true, message: `${provider.label} key deleted.` })
  }

  async function handleTest() {
    const key = draft.trim() || savedKey
    if (!key) {
      setResult({ ok: false, message: 'Add a key first.' })
      return
    }

    setBusy(true)
    setResult(null)
    try {
      setResult(await testConnection(activeProvider, model, key))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="API keys"
        description="Keys stay on this device. They are never sent to a server and never sync."
      >
        <div className="flex flex-col gap-5">
          <Select
            id="provider"
            label="Provider"
            value={activeProvider}
            options={providerList.map((p) => ({ value: p.id, label: p.label }))}
            onChange={switchProvider}
          />

          <Select
            id="model"
            label="Model"
            value={model}
            options={provider.models.map((m) => ({ value: m, label: m }))}
            onChange={(m) => setModel(activeProvider, m)}
          />

          <div className="flex flex-col gap-2">
            <label htmlFor="apikey" className="text-sm font-medium text-ink">
              {provider.label} key
            </label>
            <input
              id="apikey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setResult(null)
              }}
              placeholder={savedKey ? maskKey(savedKey) : 'Paste your key'}
              className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-ink placeholder:font-sans placeholder:text-muted"
            />
            <p className="text-xs text-muted">
              Stored in this browser's IndexedDB, which is less protected than a phone's
              keychain — anyone with access to this device or profile can read it.
            </p>
            <a
              href={provider.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent hover:underline"
            >
              Get a {provider.label} key ↗
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={draft.trim().length === 0}>
              {savedKey ? 'Replace key' : 'Save key'}
            </Button>
            <Button
              variant="ghost"
              onClick={handleTest}
              disabled={busy || (!savedKey && draft.trim().length === 0)}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {busy ? 'Testing…' : 'Test connection'}
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={!savedKey}>
              Delete key
            </Button>
          </div>

          {savedKey && (
            <div className="text-xs text-muted">
              Saved for {provider.label}: <span className="font-mono">{maskKey(savedKey)}</span>
            </div>
          )}

          {result && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={transition.tap}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                result.ok
                  ? 'border-ok/40 bg-ok/10 text-ok'
                  : 'border-bad/40 bg-bad/10 text-bad'
              }`}
              role="status"
            >
              {result.ok ? (
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              ) : (
                <XCircle className="size-4 shrink-0" aria-hidden />
              )}
              {result.message}
            </motion.div>
          )}
        </div>
      </Card>
    </div>
  )
}
