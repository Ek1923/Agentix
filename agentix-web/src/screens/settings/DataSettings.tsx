import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { AlertTriangle, Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { isBackup, queries, type TrashedItem } from '../../core/db/queries'
import { Button } from '../../ui/components/Button'
import { Card } from '../../ui/components/Card'
import { feedback } from '../../ui/feedback'
import { transition } from '../../ui/tokens'

type Result = { ok: boolean; message: string } | null

const KIND_LABELS: Record<TrashedItem['kind'], string> = {
  task: 'Task',
  note: 'Note',
  bucket: 'Column',
  person: 'Person',
  habit: 'Routine',
}

export function DataSettings() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<Result>(null)
  const [confirming, setConfirming] = useState(false)
  const [erasePhrase, setErasePhrase] = useState('')

  const trash = useLiveQuery(() => queries.listTrash(), [], [])

  async function exportBackup() {
    const backup = await queries.exportBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = `agentix-backup-${backup.exportedAt.slice(0, 10)}.json`
    link.click()
    // Revoking immediately cancels the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000)

    feedback('success')
    setResult({ ok: true, message: 'Backup downloaded.' })
  }

  async function importBackup(file: File) {
    setResult(null)
    try {
      const parsed: unknown = JSON.parse(await file.text())
      // Validated before anything is written: a bad file must fail before it lands.
      if (!isBackup(parsed)) {
        setResult({ ok: false, message: 'That is not an Agentix backup file.' })
        feedback('warning')
        return
      }

      await queries.importBackup(parsed)
      feedback('success')
      setResult({
        ok: true,
        message: `Restored ${parsed.tasks.length} tasks from ${parsed.exportedAt.slice(0, 10)}.`,
      })
    } catch {
      setResult({ ok: false, message: 'That file could not be read.' })
      feedback('warning')
    } finally {
      setConfirming(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Backup"
        description="Everything on this device, as one file. There is no server, so this is the only copy that exists."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void exportBackup()}>
              <Download className="size-4" aria-hidden />
              Export backup
            </Button>

            <Button
              variant="ghost"
              onClick={() => {
                feedback('selection')
                setConfirming(true)
              }}
            >
              <Upload className="size-4" aria-hidden />
              Restore from file
            </Button>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Backup file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importBackup(file)
            }}
          />

          {confirming && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={transition.tap}
              className="rounded-xl border border-warn/40 bg-warn/[0.06] p-3.5"
            >
              <p className="text-sm text-ink">
                Restoring replaces everything currently on this device.
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Export a backup first if you are not certain. Your API keys are not
                touched — they live in a separate store.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="danger" onClick={() => fileInput.current?.click()}>
                  Choose a file and replace
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </motion.div>
          )}

          {result && (
            <p
              role="status"
              className={`text-sm ${result.ok ? 'text-ok' : 'text-bad'}`}
            >
              {result.message}
            </p>
          )}
        </div>
      </Card>

      <Card title="Recently deleted"
        description="Deletes are soft, so nothing is ever really gone. Anything here can come back."
      >
        {trash.length === 0 ? (
          <p className="text-sm text-muted">Nothing deleted.</p>
        ) : (
          <ul className="agentix-scroll flex max-h-72 flex-col gap-2 overflow-y-auto">
            {trash.map((item) => (
              <li
                key={`${item.kind}-${item.id}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-elevated px-3 py-2"
              >
                <Trash2 className="size-3.5 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{item.label}</span>
                  <span className="block text-[11px] text-muted">
                    {KIND_LABELS[item.kind]} · deleted {item.deletedAt.slice(0, 10)}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Restore "${item.label}"`}
                  onClick={() => {
                    feedback('success')
                    void queries.restoreFromTrash(item.kind, item.id)
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/*
        Last, and after the backup card on purpose: the thing that saves you from
        this is directly above it, already read.
      */}
      <Card
        title="Erase everything"
        description="A hard delete, unlike every other delete in Agentix. Nothing goes to the trash and nothing can be restored."
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-bad/40 bg-bad/[0.06] p-3.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
            <p className="text-xs leading-relaxed text-ink">
              Every task, session, note, column, person and routine on this device.
              Export a backup first if there is any doubt. Your API keys and your
              settings are not touched.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="erasePhrase" className="text-sm font-medium text-ink">
              Type <span className="measure text-bad">ERASE</span> to confirm
            </label>
            <input
              id="erasePhrase"
              value={erasePhrase}
              onChange={(e) => setErasePhrase(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="measure w-40 rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink"
            />
          </div>

          <div>
            <Button
              variant="danger"
              disabled={erasePhrase.trim() !== 'ERASE'}
              onClick={() => {
                feedback('warning')
                void queries.eraseEverything().then(() => {
                  setErasePhrase('')
                  setResult({ ok: true, message: 'Everything erased.' })
                })
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Erase everything
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
