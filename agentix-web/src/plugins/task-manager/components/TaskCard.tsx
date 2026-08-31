import { motion } from 'framer-motion'
import {
  ArrowRightLeft,
  Check,
  Clock,
  Link2,
  Maximize2,
  Pause,
  Pencil,
  Play,
  Repeat,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import type { Bucket, Person, Task, TimeSession } from '../../../core/db/types'
import { Menu, type MenuGroup } from '../../../ui/components/Menu'
import { feedback } from '../../../ui/feedback'
import { transition } from '../../../ui/tokens'
import { linkHost } from '../logic/links'
import { canTrack, isValidTitle, PRIORITY_LABELS } from '../logic/tasks'
import {
  estimateDeltaMin,
  formatClock,
  formatDuration,
  totalDurationMs,
  totalMinutes,
} from '../logic/time'
import { PersonStack } from './PersonChip'

interface TaskCardProps {
  task: Task
  buckets: Bucket[]
  sessions: TimeSession[]
  assignees: Person[]
  isTracking: boolean
  nowIso: string
  onOpen: () => void
  onToggleDone: () => void
  onRename: (title: string) => Promise<void>
  onMove: (bucketId: string) => Promise<void>
  onDelete: () => Promise<void>
  onStart: () => void
  onStop: () => void
  onDragStart: () => void
  onDragEnd: () => void
}

/** A thin colour spine down the left edge, the way Planner marks a card. */
const PRIORITY_SPINE: Record<0 | 1 | 2, string> = {
  0: 'bg-transparent',
  1: 'bg-warn',
  2: 'bg-bad',
}

const PRIORITY_CHIP: Record<0 | 1 | 2, string> = {
  0: '',
  1: 'bg-warn/15 text-warn',
  2: 'bg-bad/15 text-bad',
}

export function TaskCard({
  task,
  buckets,
  sessions,
  assignees,
  isTracking,
  nowIso,
  onOpen,
  onToggleDone,
  onRename,
  onMove,
  onDelete,
  onStart,
  onStop,
  onDragStart,
  onDragEnd,
}: TaskCardProps) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(task.title)

  const trackedMs = totalDurationMs(sessions, nowIso)
  const delta = estimateDeltaMin(task.estimateMin, totalMinutes(sessions, nowIso))
  const done = task.status === 'done'
  // Today's instance of a routine. It behaves like any other card; it is marked so
  // that finishing it, and seeing it again tomorrow, is not a surprise.
  const routine = task.habitId !== null

  async function commitRename() {
    const trimmed = draft.trim()
    if (!isValidTitle(trimmed) || trimmed === task.title) {
      setDraft(task.title)
      setRenaming(false)
      return
    }
    await onRename(trimmed)
    setRenaming(false)
    feedback('light')
  }

  const groups: MenuGroup[] = [
    {
      items: [
        {
          id: 'rename',
          label: 'Rename',
          icon: <Pencil className="size-4" aria-hidden />,
          onSelect: () => {
            setDraft(task.title)
            setRenaming(true)
          },
        },
        {
          id: 'details',
          label: 'Open details',
          icon: <Maximize2 className="size-4" aria-hidden />,
          onSelect: onOpen,
        },
      ],
    },
    // Only columns it is not already in — offering a move to where it already
    // sits is a menu item that does nothing.
    {
      label: 'Move to',
      items: buckets
        .filter((bucket) => bucket.id !== task.bucketId)
        .map((bucket) => ({
          id: bucket.id,
          label: bucket.name,
          icon: <ArrowRightLeft className="size-4" aria-hidden />,
          onSelect: () => void onMove(bucket.id),
        })),
    },
    {
      items: [
        {
          id: 'delete',
          // Removing a routine's card is skipping the day, not deleting the
          // routine — it is back tomorrow, and the streak notes the miss.
          label: routine ? 'Skip today' : 'Delete task',
          icon: <Trash2 className="size-4" aria-hidden />,
          danger: true,
          onSelect: () => {
            feedback('warning')
            void onDelete()
          },
        },
      ],
    },
  ].filter((group) => group.items.length > 0)

  return (
    <motion.li
      layout
      // Deliberately no layoutId. Each column owns its own AnimatePresence, and a
      // shared layoutId across two of them keeps the card mounted in the old
      // column while it mounts in the new one — a visible duplicate mid-move.
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
      whileHover={{ y: -2 }}
      whileDrag={{ scale: 1.03, rotate: -1.2 }}
      // A card being renamed must not be draggable, or the input cannot be
      // selected with the mouse.
      draggable={!renaming}
      onDragStart={(e) => {
        // dataTransfer is what makes the drop target able to identify the card.
        ;(e as unknown as DragEvent).dataTransfer?.setData('text/plain', task.id)
        feedback('light')
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={`group relative overflow-hidden rounded-2xl border bg-raised shadow-sm transition-shadow hover:shadow-md ${
        isTracking ? 'border-accent/70 ring-1 ring-accent/30' : 'border-line'
      }`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1 ${PRIORITY_SPINE[task.priority]}`}
        aria-hidden
      />

      <div className="flex flex-col gap-2.5 p-3.5">
        <div className="flex items-start gap-2.5 pl-1.5">
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={`Mark "${task.title}" ${done ? 'not done' : 'done'}`}
            onClick={() => {
              feedback(done ? 'light' : 'success')
              onToggleDone()
            }}
            className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md border transition-colors ${
              done ? 'border-ok bg-ok text-surface' : 'border-muted hover:border-ink'
            }`}
          >
            {done && <Check className="size-3" aria-hidden />}
          </button>

          {renaming ? (
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <label htmlFor={`rename-${task.id}`} className="sr-only">
                Task title
              </label>
              <input
                id={`rename-${task.id}`}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename()
                  if (e.key === 'Escape') {
                    setDraft(task.title)
                    setRenaming(false)
                  }
                }}
                maxLength={200}
                className="w-full rounded-lg border border-accent bg-surface px-2 py-1 text-sm text-ink"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void commitRename()}
                  className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-surface"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(task.title)
                    setRenaming(false)
                  }}
                  className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-muted hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/*
                The title opens the task. A button rather than a click handler on
                the card, so the keyboard reaches it and dragging stays a mouse
                affordance.
              */}
              <button
                type="button"
                onClick={onOpen}
                className={`min-w-0 flex-1 break-words text-left text-sm font-medium leading-snug transition-colors hover:text-accent ${
                  done ? 'text-muted line-through' : 'text-ink'
                }`}
              >
                {task.title}
              </button>

              <Menu label={`More actions for "${task.title}"`} groups={groups} />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pl-1.5">
          {routine && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
              <Repeat className="size-3 shrink-0" aria-hidden />
              Routine
            </span>
          )}
          {task.priority > 0 && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY_CHIP[task.priority]}`}
            >
              {PRIORITY_LABELS[task.priority]}
            </span>
          )}
          {task.link && (
            <span className="inline-flex max-w-[10rem] items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
              <Link2 className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{linkHost(task.link)}</span>
            </span>
          )}
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="max-w-[8rem] truncate rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent"
            >
              {tag}
            </span>
          ))}
          {task.estimateMin !== null && (
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">
              est {task.estimateMin}m
            </span>
          )}
          {trackedMs > 0 && !isTracking && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">
              <Clock className="size-3" aria-hidden />
              {formatDuration(trackedMs)}
            </span>
          )}
          {done && delta !== null && delta !== 0 && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                delta > 0 ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok'
              }`}
            >
              {delta > 0 ? `${delta}m over` : `${Math.abs(delta)}m under`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 pl-1.5">
          <PersonStack people={assignees} />

          <span className="flex-1" />

          {isTracking && (
            <span
              className="measure text-xs text-accent"
              aria-label="Time on this task"
            >
              {formatClock(trackedMs)}
            </span>
          )}

          {canTrack(task) && (
            <motion.button
              type="button"
              onClick={() => {
                feedback('medium')
                if (isTracking) onStop()
                else onStart()
              }}
              whileTap={{ scale: 0.92 }}
              transition={transition.tap}
              aria-label={
                isTracking
                  ? `Stop timer for "${task.title}"`
                  : `Start timer for "${task.title}"`
              }
              className={`flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                isTracking
                  ? 'border-accent bg-accent text-surface'
                  : 'border-line text-muted hover:border-accent hover:text-accent'
              }`}
            >
              {isTracking ? (
                <Pause className="size-3.5" aria-hidden />
              ) : (
                <Play className="size-3.5" aria-hidden />
              )}
            </motion.button>
          )}
        </div>
      </div>
    </motion.li>
  )
}
