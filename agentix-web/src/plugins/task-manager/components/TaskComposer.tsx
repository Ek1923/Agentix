import { AnimatePresence, motion } from 'framer-motion'
import { Link2, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { Person } from '../../../core/db/types'
import { Button } from '../../../ui/components/Button'
import { feedback } from '../../../ui/feedback'
import { transition } from '../../../ui/tokens'
import { isValidLink, normaliseLink } from '../logic/links'
import { isValidTitle, parseEstimate } from '../logic/tasks'
import { PeoplePicker } from './PeoplePicker'
import { PrioritySelect } from './PrioritySelect'

export interface ComposerInput {
  title: string
  link: string | null
  estimateMin: number | null
  priority: 0 | 1 | 2
  assigneeIds: string[]
}

interface TaskComposerProps {
  people: Person[]
  /** Where the priority control starts, so someone whose work is mostly urgent
      is not re-picking it on every task. */
  defaultPriority: 0 | 1 | 2
  onAdd: (input: ComposerInput) => Promise<void>
  onCreatePerson: (name: string, colorId: string) => Promise<void>
}

/**
 * Collapsed to a single "+ Add task" until it is needed. The full form is five
 * fields, and five fields permanently open makes an empty board look like paperwork.
 */
export function TaskComposer({
  people,
  defaultPriority,
  onAdd,
  onCreatePerson,
}: TaskComposerProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [link, setLink] = useState('')
  const [estimate, setEstimate] = useState('')
  const [priority, setPriority] = useState<0 | 1 | 2>(defaultPriority)
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const linkTouched = link.trim() !== ''
  const linkOk = !linkTouched || isValidLink(link)
  const valid = isValidTitle(title) && linkOk

  function reset() {
    setTitle('')
    setLink('')
    setEstimate('')
    setPriority(defaultPriority)
    setAssigneeIds([])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || saving) return

    setSaving(true)
    try {
      await onAdd({
        title: title.trim(),
        link: normaliseLink(link),
        estimateMin: parseEstimate(estimate),
        priority,
        assigneeIds,
      })
      reset()
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <motion.button
        type="button"
        onClick={() => {
          feedback('selection')
          setOpen(true)
        }}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.99 }}
        transition={transition.tap}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3.5 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-accent"
      >
        <Plus className="size-4" aria-hidden />
        Add task
      </motion.button>
    )
  }

  return (
    <AnimatePresence initial={false}>
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transition.screen}
        className="flex flex-col gap-4 card rounded-2xl p-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <label htmlFor="taskTitle" className="text-sm font-medium text-ink">
              New task
            </label>
            <input
              id="taskTitle"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              maxLength={200}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
          </div>
          <button
            type="button"
            aria-label="Close the new task form"
            onClick={() => {
              setOpen(false)
              reset()
            }}
            className="mt-7 flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="taskLink" className="text-sm font-medium text-ink">
            Link
          </label>
          <div
            className={`flex items-center gap-2 rounded-lg border bg-surface px-3 ${
              linkOk ? 'border-line' : 'border-bad'
            }`}
          >
            <Link2 className="size-4 shrink-0 text-muted" aria-hidden />
            <input
              id="taskLink"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste a link (optional)"
              inputMode="url"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink placeholder:text-muted focus:outline-none"
            />
          </div>
          {!linkOk && (
            <p className="text-xs text-bad">
              That is not a web address. Only http and https links can be opened.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex w-28 flex-col gap-2">
            <label htmlFor="taskEstimate" className="text-sm font-medium text-ink">
              Estimate
            </label>
            <input
              id="taskEstimate"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              inputMode="numeric"
              placeholder="min"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Priority</span>
            <PrioritySelect value={priority} onChange={setPriority} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">People</span>
          <PeoplePicker
            people={people}
            selectedIds={assigneeIds}
            onToggle={(id) =>
              setAssigneeIds((current) =>
                current.includes(id) ? current.filter((a) => a !== id) : [...current, id],
              )
            }
            onCreate={onCreatePerson}
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={!valid || saving}>
            <Plus className="size-4" aria-hidden />
            Add task
          </Button>
        </div>
      </motion.form>
    </AnimatePresence>
  )
}
