import { motion } from 'framer-motion'
import { CalendarPlus, Check, PlayCircle, Trash2 } from 'lucide-react'
import type { Task } from '../../../core/db/types'
import { feedback } from '../../../ui/feedback'
import { PRIORITY_LABELS } from '../../task-manager/logic/tasks'
import { KIND_LABELS, reasonFor, type Suggestion } from '../logic/suggestions'

interface SuggestionCardProps {
  suggestion: Suggestion
  task: Task
  onMoveToToday: () => Promise<void>
  onMoveToTomorrow: () => Promise<void>
  onComplete: () => Promise<void>
  onDrop: () => Promise<void>
}

const KIND_STYLES: Record<Suggestion['kind'], string> = {
  resume: 'border-accent/50 bg-accent/[0.06]',
  reschedule: 'border-line bg-raised',
  drop: 'border-warn/40 bg-warn/[0.05]',
}

const KIND_CHIP: Record<Suggestion['kind'], string> = {
  resume: 'bg-accent/15 text-accent',
  reschedule: 'bg-surface text-muted',
  drop: 'bg-warn/15 text-warn',
}

export function SuggestionCard({
  suggestion,
  task,
  onMoveToToday,
  onMoveToTomorrow,
  onComplete,
  onDrop,
}: SuggestionCardProps) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className={`flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md ${
        KIND_STYLES[suggestion.kind]
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${KIND_CHIP[suggestion.kind]}`}
        >
          {KIND_LABELS[suggestion.kind]}
        </span>
        {task.priority > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              task.priority === 2 ? 'bg-bad/15 text-bad' : 'bg-warn/15 text-warn'
            }`}
          >
            {PRIORITY_LABELS[task.priority]}
          </span>
        )}
        {task.estimateMin !== null && (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">
            est {task.estimateMin}m
          </span>
        )}
      </div>

      <div>
        <p className="break-words text-sm font-medium leading-snug text-ink">{task.title}</p>
        {/*
          The reason is assembled from the suggestion's own measured fields, so it
          can only state something that is true of this task.
        */}
        <p className="mt-1 text-xs text-muted">{reasonFor(suggestion)}</p>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line/70 pt-3">
        <button
          type="button"
          onClick={() => {
            feedback('light')
            void onMoveToToday()
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
        >
          <PlayCircle className="size-3.5" aria-hidden />
          {suggestion.kind === 'resume' ? 'Finish today' : 'Do today'}
        </button>

        <button
          type="button"
          onClick={() => {
            feedback('light')
            void onMoveToTomorrow()
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-muted hover:text-ink"
        >
          <CalendarPlus className="size-3.5" aria-hidden />
          Tomorrow
        </button>

        <span className="flex-1" />

        <button
          type="button"
          onClick={() => {
            feedback('success')
            void onComplete()
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ok/40 px-3 py-1.5 text-xs text-ok transition-colors hover:border-ok"
        >
          <Check className="size-3.5" aria-hidden />
          Already done
        </button>

        <button
          type="button"
          onClick={() => {
            feedback('warning')
            void onDrop()
          }}
          aria-label={`Drop "${task.title}"`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-bad/40 px-3 py-1.5 text-xs text-bad transition-colors hover:border-bad"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Drop
        </button>
      </div>
    </motion.li>
  )
}
