import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, Link2, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Bucket, Person, Task, TimeSession } from '../../../core/db/types'
import { feedback } from '../../../ui/feedback'
import { transition } from '../../../ui/tokens'
import { isValidLink, linkHost, linkPath, normaliseLink } from '../logic/links'
import { estimateDeltaMin, formatDuration, totalDurationMs, totalMinutes } from '../logic/time'
import { PeoplePicker } from './PeoplePicker'
import { PrioritySelect } from './PrioritySelect'
import { TagEditor } from './TagEditor'

interface TaskDetailProps {
  task: Task
  buckets: Bucket[]
  people: Person[]
  sessions: TimeSession[]
  nowIso: string
  onClose: () => void
  onPatch: (patch: Partial<Task>) => Promise<void>
  onMoveToBucket: (bucketId: string) => Promise<void>
  onDelete: () => Promise<void>
  onCreatePerson: (name: string, colorId: string) => Promise<void>
  /** Tags already used elsewhere, offered as suggestions. */
  knownTags: string[]
}

export function TaskDetail({
  task,
  buckets,
  people,
  sessions,
  nowIso,
  onClose,
  onPatch,
  onMoveToBucket,
  onDelete,
  onCreatePerson,
  knownTags,
}: TaskDetailProps) {
  const [title, setTitle] = useState(task.title)
  const [link, setLink] = useState(task.link ?? '')
  const [editingLink, setEditingLink] = useState(false)

  // Escape closes the panel, the way every other modal on the web does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const trackedMs = totalDurationMs(sessions, nowIso)
  const delta = estimateDeltaMin(task.estimateMin, totalMinutes(sessions, nowIso))
  const linkOk = link.trim() === '' || isValidLink(link)
  const assignees = people.filter((p) => task.assigneeIds.includes(p.id))

  async function saveLink() {
    if (!linkOk) return
    await onPatch({ link: normaliseLink(link) })
    setEditingLink(false)
    feedback('light')
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={transition.tap}
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={task.title}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
          className="agentix-scroll max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-raised p-6 shadow-2xl sm:rounded-3xl"
        >
          <div className="flex items-start justify-between gap-4">
            <label htmlFor="detailTitle" className="sr-only">
              Task title
            </label>
            <input
              id="detailTitle"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                const trimmed = title.trim()
                if (trimmed !== '' && trimmed !== task.title) void onPatch({ title: trimmed })
                else setTitle(task.title)
              }}
              maxLength={200}
              className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold text-ink transition-colors hover:border-line focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {/*
            The link is the largest thing on the panel by design — it is usually
            the reason the task exists, and a task you open is a task you are
            about to act on.
          */}
          <div className="mt-5">
            {task.link && !editingLink ? (
              <div className="flex items-stretch gap-2">
                <a
                  href={task.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={() => feedback('light')}
                  className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-accent/40 bg-accent/[0.08] px-4 py-4 transition-colors hover:border-accent hover:bg-accent/[0.14]"
                >
                  <Link2 className="size-5 shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-semibold leading-tight text-accent">
                      {linkHost(task.link)}
                    </span>
                    {linkPath(task.link) && (
                      <span className="block truncate text-xs text-muted">
                        {linkPath(task.link)}
                      </span>
                    )}
                  </span>
                  <ArrowUpRight
                    className="size-5 shrink-0 text-accent transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </a>
                <button
                  type="button"
                  onClick={() => setEditingLink(true)}
                  className="shrink-0 rounded-2xl border border-line px-3 text-xs text-muted transition-colors hover:border-muted hover:text-ink"
                >
                  Edit
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <label htmlFor="detailLink" className="text-sm font-medium text-ink">
                  Link
                </label>
                <div
                  className={`flex items-center gap-2 rounded-lg border bg-surface px-3 ${
                    linkOk ? 'border-line' : 'border-bad'
                  }`}
                >
                  <Link2 className="size-4 shrink-0 text-muted" aria-hidden />
                  <input
                    id="detailLink"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="Paste a link"
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
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveLink()}
                    disabled={!linkOk}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-40"
                  >
                    Save link
                  </button>
                  {task.link && (
                    <button
                      type="button"
                      onClick={() => {
                        setLink('')
                        void onPatch({ link: null })
                        setEditingLink(false)
                      }}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-bad"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="detailBucket" className="text-sm font-medium text-ink">
                Column
              </label>
              <select
                id="detailBucket"
                value={task.bucketId}
                onChange={(e) => {
                  feedback('selection')
                  void onMoveToBucket(e.target.value)
                }}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              >
                {buckets.map((bucket) => (
                  <option key={bucket.id} value={bucket.id}>
                    {bucket.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink">Priority</span>
              <PrioritySelect
                value={task.priority}
                onChange={(priority) => void onPatch({ priority })}
                fill
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Tags</span>
            <TagEditor
              tags={task.tags}
              suggestions={knownTags}
              onChange={(tags) => onPatch({ tags })}
            />
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">
              People {assignees.length > 0 && `(${assignees.length})`}
            </span>
            <PeoplePicker
              people={people}
              selectedIds={task.assigneeIds}
              onToggle={(id) =>
                void onPatch({
                  assigneeIds: task.assigneeIds.includes(id)
                    ? task.assigneeIds.filter((a) => a !== id)
                    : [...task.assigneeIds, id],
                })
              }
              onCreate={onCreatePerson}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5 text-xs text-muted">
            {task.estimateMin !== null && (
              <span className="rounded-full bg-surface px-2.5 py-1">
                est {task.estimateMin}m
              </span>
            )}
            {trackedMs > 0 && (
              <span className="rounded-full bg-surface px-2.5 py-1">
                tracked {formatDuration(trackedMs)}
              </span>
            )}
            {sessions.length > 0 && (
              <span className="rounded-full bg-surface px-2.5 py-1">
                {sessions.length} session{sessions.length === 1 ? '' : 's'}
              </span>
            )}
            {task.status === 'done' && delta !== null && delta !== 0 && (
              <span
                className={`rounded-full px-2.5 py-1 font-medium ${
                  delta > 0 ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok'
                }`}
              >
                {delta > 0 ? `${delta}m over estimate` : `${Math.abs(delta)}m under estimate`}
              </span>
            )}
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => {
                feedback('warning')
                void onDelete()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-bad/40 px-3 py-1.5 text-xs text-bad transition-colors hover:border-bad"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Delete task
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
