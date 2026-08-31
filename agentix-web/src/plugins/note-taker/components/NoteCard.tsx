import { motion } from 'framer-motion'
import { Check, Link2, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { Note, Task } from '../../../core/db/types'
import { feedback } from '../../../ui/feedback'
import { transition } from '../../../ui/tokens'
import { canSummarise, MIN_SUMMARY_CHARS, wordCount } from '../logic/notes'

interface NoteCardProps {
  note: Note
  task: Task | undefined
  aiConfigured: boolean
  summarising: boolean
  error: string | null
  onSave: (content: string) => Promise<void>
  onSummarise: () => Promise<void>
  onDelete: () => Promise<void>
  onOpenSettings: () => void
}

export function NoteCard({
  note,
  task,
  aiConfigured,
  summarising,
  error,
  onSave,
  onSummarise,
  onDelete,
  onOpenSettings,
}: NoteCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.content)

  const longEnough = canSummarise(note.content)

  async function save() {
    const trimmed = draft.trim()
    if (trimmed === '' || trimmed === note.content) {
      setDraft(note.content)
      setEditing(false)
      return
    }
    await onSave(trimmed)
    setEditing(false)
    feedback('light')
  }

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="flex flex-col gap-3 card rounded-2xl p-4 transition-shadow hover:card-lift"
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`note-${note.id}`} className="sr-only">
            Note content
          </label>
          <textarea
            id={`note-${note.id}`}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            className="w-full resize-y rounded-lg border border-accent bg-surface px-3 py-2 text-sm leading-relaxed text-ink"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-surface"
            >
              <Check className="size-3.5" aria-hidden />
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(note.content)
                setEditing(false)
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit note: ${note.content.slice(0, 40)}`}
          className="whitespace-pre-wrap break-words text-left text-sm leading-relaxed text-ink transition-colors hover:text-accent"
        >
          {note.content}
        </button>
      )}

      {note.aiSummary && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={transition.tap}
          className="overflow-hidden rounded-xl border border-accent/30 bg-accent/[0.07] p-3"
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-accent" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">
              Summary
            </span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
            {note.aiSummary}
          </p>
        </motion.div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
          <X className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {task && (
          <span className="inline-flex max-w-[12rem] items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">
            <Link2 className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{task.title}</span>
          </span>
        )}
        <span className="text-[11px] text-muted">{wordCount(note.content)} words</span>

        <span className="flex-1" />

        {/*
          Without a key this is a pointer at Settings, not an error and not a
          disabled button with no explanation. The note itself is unaffected.
        */}
        {!aiConfigured ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <Sparkles className="size-3" aria-hidden />
            Add a key to summarise
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              feedback('medium')
              void onSummarise()
            }}
            disabled={summarising || !longEnough}
            title={
              longEnough
                ? undefined
                : `Notes under ${MIN_SUMMARY_CHARS} characters are already shorter than a summary.`
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {summarising ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3" aria-hidden />
            )}
            {summarising ? 'Summarising…' : note.aiSummary ? 'Re-summarise' : 'Summarise'}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            feedback('warning')
            void onDelete()
          }}
          aria-label="Delete note"
          className="flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:text-bad"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
    </motion.li>
  )
}
