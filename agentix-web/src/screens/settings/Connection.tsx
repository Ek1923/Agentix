import { Check, Link2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { HealthResult } from '../../core/sync/health'
import {
  activeProject,
  forgetProject,
  listProjects,
  renameProject,
  saveProject,
  selectProject,
  sortProjects,
  toConfig,
  type SavedProject,
} from '../../core/sync/projects'
import { isConfiguredByBuild, isValidProjectUrl } from '../../core/sync/supabase'
import { useHealth } from '../../shell/useHealth'
import { Button } from '../../ui/components/Button'
import { Card } from '../../ui/components/Card'
import { feedback } from '../../ui/feedback'

/**
 * Every project this device knows, and which one is live.
 *
 * This used to hold one project in two fields, which meant moving between a
 * staging project and a real one was a trip to the dashboard for a forty-
 * character key each way. Now the device remembers what it has been connected to
 * and switching is a click.
 *
 * Storing these in the browser is safe in a way an AI key never is: both values
 * are meant to be public. The anon key ships inside every deployed bundle, and
 * row-level security is what actually keeps one account's rows from another's.
 */
export function Connection() {
  // Not live-queried: localStorage has no change events worth subscribing to, and
  // this screen is the only thing that writes here. A counter is honest about that.
  const [, setRevision] = useState(0)
  const refresh = () => setRevision((n) => n + 1)

  const projects = sortProjects(listProjects())
  const active = activeProject()
  const fromBuild = isConfiguredByBuild()

  const [adding, setAdding] = useState(false)

  const { health, check, checking } = useHealth(active === null ? null : toConfig(active))

  return (
    <Card
      title="Sync server"
      description="Where your account lives and where your work syncs. Everything keeps working while this is disconnected — it just stops sending."
    >
      <div className="flex flex-col gap-5">
        {projects.length === 0 ? (
          <p className="text-sm text-muted">
            {fromBuild
              ? 'This build ships a project. Add one here only to point somewhere else.'
              : 'No project yet. Add one to enable signing in and syncing.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                live={project.id === active?.id}
                health={project.id === active?.id ? health : null}
                checking={checking && project.id === active?.id}
                onSelect={() => {
                  selectProject(project.id)
                  feedback('success')
                  refresh()
                }}
                onRename={(label) => {
                  renameProject(project.id, label)
                  refresh()
                }}
                onCheck={check}
                onForget={() => {
                  forgetProject(project.id)
                  feedback('warning')
                  refresh()
                }}
              />
            ))}
          </ul>
        )}

        {adding ? (
          <AddProject
            onCancel={() => setAdding(false)}
            onAdd={(url, anonKey) => {
              saveProject(url, anonKey)
              feedback('success')
              setAdding(false)
              refresh()
            }}
          />
        ) : (
          <div>
            <Button variant="ghost" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              Add a project
            </Button>
          </div>
        )}

        <p className="border-t border-line pt-3 text-xs leading-relaxed text-muted">
          Your project needs its tables created first — the SQL is in
          <span className="measure text-ink"> src/core/sync/README.md</span>. Google and
          Apple sign-in are switched on per project, under Authentication → Providers.
          Full walkthrough in <span className="measure text-ink">CONNECTING.md</span>.
        </p>
      </div>
    </Card>
  )
}

const DOT: Record<HealthResult['status'], string> = {
  online: 'bg-ok',
  unauthorized: 'bg-warn',
  offline: 'bg-bad',
  unknown: 'bg-line',
}

function ProjectRow({
  project,
  live,
  health,
  checking,
  onSelect,
  onRename,
  onCheck,
  onForget,
}: {
  project: SavedProject
  live: boolean
  health: HealthResult | null
  checking: boolean
  onSelect: () => void
  onRename: (label: string) => void
  onCheck: () => void
  onForget: () => void
}) {
  const [label, setLabel] = useState(project.label)
  const [confirming, setConfirming] = useState(false)

  return (
    <li
      className={`rounded-xl border p-3 ${live ? 'border-accent bg-accent/5' : 'border-line'}`}
    >
      <div className="flex items-center gap-3">
        {/* The light only ever describes the live project — the others are not
            being polled, and a stale dot would be a claim about a server nobody
            asked. */}
        <span
          aria-hidden
          className={`size-2.5 shrink-0 rounded-full ${
            live ? DOT[health?.status ?? 'unknown'] : 'bg-line'
          } ${checking ? 'animate-pulse' : ''}`}
        />

        <div className="min-w-0 flex-1">
          <input
            aria-label={`Name for ${project.url}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => onRename(label)}
            className="w-full bg-transparent text-sm font-medium text-ink focus:outline-none"
          />
          <p className="truncate text-xs text-muted">{project.url}</p>
          {live && health !== null && (
            <p
              className={`mt-0.5 text-xs ${
                checking && health.status === 'unknown'
                  ? 'text-muted'
                  : health.status === 'online'
                    ? 'text-muted'
                    : health.status === 'unauthorized'
                      ? 'text-warn'
                      : 'text-bad'
              }`}
            >
              {/*
                A check in flight is not the same as one that never ran. Saying
                "not checked yet" while actively waiting on the first answer reads
                as a refusal to look.
              */}
              {checking && health.status === 'unknown' ? 'Checking…' : health.message}
            </p>
          )}
        </div>

        {live ? (
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            aria-label="Check now"
            title="Check now"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${checking ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSelect}
            className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink transition-colors hover:border-muted"
          >
            Use this
          </button>
        )}

        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Forget ${project.label}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-bad/10 hover:text-bad"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>

      {confirming && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <p className="min-w-0 flex-1 text-xs text-muted">
            Forget this project on this device? Nothing on the server changes.
          </p>
          <Button variant="danger" onClick={onForget}>
            Forget
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      )}
    </li>
  )
}

function AddProject({
  onAdd,
  onCancel,
}: {
  onAdd: (url: string, anonKey: string) => void
  onCancel: () => void
}) {
  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')

  const urlOk = url.trim() === '' || isValidProjectUrl(url)
  const ready = isValidProjectUrl(url) && anonKey.trim().length > 20

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line p-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="supabaseUrl" className="text-sm font-medium text-ink">
          Project URL
        </label>
        <div
          className={`flex items-center gap-2 rounded-lg border bg-elevated px-3 ${
            urlOk ? 'border-line' : 'border-bad'
          }`}
        >
          <Link2 className="size-4 shrink-0 text-muted" aria-hidden />
          <input
            id="supabaseUrl"
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
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink placeholder:text-muted focus:outline-none"
          />
        </div>
        {!urlOk && <p className="text-xs text-bad">That needs to be an https address.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="supabaseKey" className="text-sm font-medium text-ink">
          Anon key
        </label>
        <input
          id="supabaseKey"
          value={anonKey}
          onChange={(e) => setAnonKey(e.target.value)}
          placeholder="Paste the anon public key"
          spellCheck={false}
          className="measure rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-ink placeholder:font-sans placeholder:text-muted"
        />
        <p className="text-xs leading-relaxed text-muted">
          The <strong className="text-ink">anon public</strong> key, not the service role
          key. The anon key is meant to be public; the service role key bypasses every
          security rule and must never leave your server.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={!ready} onClick={() => onAdd(url, anonKey)}>
          <Check className="size-4" aria-hidden />
          Save and use
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
