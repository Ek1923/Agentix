import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence } from 'framer-motion'
import { KeyRound, NotebookPen, Search, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { PluginContext } from '../../core/plugin-host/types'
import { EmptyState } from '../../ui/components/EmptyState'
import { NoteCard } from './components/NoteCard'
import { NoteComposer } from './components/NoteComposer'
import { countNotes, filterNotes, sortNotes } from './logic/notes'
import { cleanSummary, summaryPrompt } from './logic/prompt'

export function NoteTaker({ ctx }: { ctx: PluginContext }) {
  const [query, setQuery] = useState('')
  const [summarisingId, setSummarisingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const notes = useLiveQuery(() => ctx.db.listNotes(), [])
  const tasks = useLiveQuery(() => ctx.db.listRecentTasks(7), [], [])

  // Live: saving a key in Settings re-enables summarising here without a reload.
  const aiConfigured = useLiveQuery(() => ctx.ai.isConfigured(), [], false)

  if (notes === undefined) return null

  const visible = filterNotes(sortNotes(notes), query)
  const counts = countNotes(notes)
  const taskById = new Map(tasks.map((t) => [t.id, t]))

  async function summarise(noteId: string) {
    const note = await ctx.db.getNote(noteId)
    if (!note) return

    setSummarisingId(noteId)
    setErrors((current) => {
      const next = { ...current }
      delete next[noteId]
      return next
    })

    try {
      const task = note.taskId === null ? undefined : await ctx.db.getTask(note.taskId)
      const reply = await ctx.ai.complete(summaryPrompt(note.content, task?.title ?? null))
      await ctx.db.updateNote(noteId, { aiSummary: cleanSummary(reply) })
    } catch (err) {
      // ProviderError messages are written to be safe to display. Anything else is
      // replaced rather than surfaced, because an unknown error may quote the request.
      const message =
        err instanceof Error && err.name === 'ProviderError'
          ? err.message
          : 'Could not summarise this note.'
      setErrors((current) => ({ ...current, [noteId]: message }))
    } finally {
      setSummarisingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-base text-ink">Notes</h2>
        {counts.total > 0 && (
          <p className="text-xs text-muted">
            {counts.total} note{counts.total === 1 ? '' : 's'}
            {counts.summarised > 0 && ` · ${counts.summarised} summarised`}
            {counts.linked > 0 && ` · ${counts.linked} linked to a task`}
          </p>
        )}
      </div>

      {/*
        Shown once, at the top, rather than as an error on every note. Without a
        key the plugin still writes, edits, links and deletes notes — only the
        summary is unavailable, and that is a missing feature, not a failure.
      */}
      {!aiConfigured && (
        <div className="flex items-start gap-3 card rounded-2xl p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-muted">
            <KeyRound className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">Notes work without a key.</p>
            <p className="mt-0.5 text-xs text-muted">
              Add an API key in Settings to summarise them with AI.
            </p>
          </div>
          <button
            type="button"
            onClick={() => ctx.navigate('settings')}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
          >
            Settings
          </button>
        </div>
      )}

      <NoteComposer
        tasks={tasks}
        onAdd={async (content, taskId) => {
          await ctx.db.createNote({ content, taskId })
        }}
      />

      {notes.length > 3 && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <label htmlFor="noteSearch" className="sr-only">
            Search notes
          </label>
          <input
            id="noteSearch"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink placeholder:text-muted focus:outline-none"
          />
        </div>
      )}

      {notes.length === 0 ? (
        <EmptyState
          icon={<NotebookPen className="size-8" aria-hidden />}
          title="No notes yet."
          body="Write anything above. Attach it to a task to keep the thinking next to the work."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Search className="size-8" aria-hidden />}
          title="Nothing matches that."
          body="Try a shorter search, or clear it to see every note again."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {visible.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                task={note.taskId === null ? undefined : taskById.get(note.taskId)}
                aiConfigured={aiConfigured}
                summarising={summarisingId === note.id}
                error={errors[note.id] ?? null}
                onSave={async (content) => {
                  await ctx.db.updateNote(note.id, { content })
                }}
                onSummarise={() => summarise(note.id)}
                onDelete={async () => {
                  await ctx.db.deleteNote(note.id)
                }}
                onOpenSettings={() => ctx.navigate('settings')}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {aiConfigured && counts.total > 0 && (
        <p className="flex items-center gap-1.5 text-center text-xs text-muted">
          <Sparkles className="size-3 shrink-0" aria-hidden />
          Summaries are generated on this device using your own API key.
        </p>
      )}
    </div>
  )
}
