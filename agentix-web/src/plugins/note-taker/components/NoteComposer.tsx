import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { Task } from '../../../core/db/types'
import { Button } from '../../../ui/components/Button'
import { feedback } from '../../../ui/feedback'
import { transition } from '../../../ui/tokens'
import { isValidNote, wordCount } from '../logic/notes'

interface NoteComposerProps {
  tasks: Task[]
  onAdd: (content: string, taskId: string | null) => Promise<void>
}

export function NoteComposer({ tasks, onAdd }: NoteComposerProps) {
  const [content, setContent] = useState('')
  const [taskId, setTaskId] = useState('')
  const [saving, setSaving] = useState(false)

  const valid = isValidNote(content)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || saving) return

    setSaving(true)
    try {
      await onAdd(content.trim(), taskId === '' ? null : taskId)
      setContent('')
      setTaskId('')
      feedback('light')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition.screen}
      className="flex flex-col gap-3 card rounded-2xl p-4"
    >
      <label htmlFor="noteContent" className="text-sm font-medium text-ink">
        New note
      </label>
      <textarea
        id="noteContent"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write it down before it is gone."
        rows={4}
        className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-muted"
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor="noteTask" className="text-sm font-medium text-ink">
            Attach to a task
          </label>
          <select
            id="noteTask"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="">Standalone note</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          {valid && (
            <span className="text-xs text-muted">{wordCount(content)} words</span>
          )}
          <Button type="submit" disabled={!valid || saving}>
            <Plus className="size-4" aria-hidden />
            Add note
          </Button>
        </div>
      </div>
    </motion.form>
  )
}
