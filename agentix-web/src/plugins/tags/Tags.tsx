import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Check, ChevronDown, Pencil, Tag as TagIcon, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { PluginContext } from '../../core/plugin-host/types'
import { EmptyState } from '../../ui/components/EmptyState'
import { PageHeader } from '../../ui/components/PageHeader'
import { SegmentedControl } from '../../ui/components/SegmentedControl'
import { feedback } from '../../ui/feedback'
import {
  formatMinutes,
  isValidTag,
  normaliseTag,
  sortTagStats,
  statsByTag,
  untaggedCount,
  type TagSort,
} from './logic/tags'

const WINDOW_DAYS = 30

const SORTS: Array<{ id: TagSort; label: string }> = [
  { id: 'time', label: 'Time' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'name', label: 'Name' },
]

export function Tags({ ctx }: { ctx: PluginContext }) {
  const [sort, setSort] = useState<TagSort>('time')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // A number without the work behind it is a number you cannot act on.
  const [expanded, setExpanded] = useState<string | null>(null)

  const tasks = useLiveQuery(() => ctx.db.listRecentTasks(WINDOW_DAYS), [])
  const sessions = useLiveQuery(
    async () => {
      const recent = await ctx.db.listRecentTasks(WINDOW_DAYS)
      return ctx.db.listSessionsForTasks(recent.map((t) => t.id))
    },
    [],
    [],
  )

  if (tasks === undefined) return null

  const stats = sortTagStats(statsByTag(tasks, sessions, new Date().toISOString()), sort)
  const untagged = untaggedCount(tasks)
  const peak = Math.max(1, ...stats.map((s) => s.trackedMinutes))

  async function commitRename(from: string) {
    const to = normaliseTag(draft)
    if (to === null || to === from) {
      setEditing(null)
      return
    }
    await ctx.db.renameTag(from, to)
    setEditing(null)
    feedback('light')
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Last ${WINDOW_DAYS} days`}
        meta={
          untagged > 0
            ? `Where the time went · ${untagged} task${untagged === 1 ? '' : 's'} carry no tag`
            : 'Where the time went'
        }
        trailing={
          <SegmentedControl
            label="Sort by"
            value={sort}
            segments={SORTS.map((option) => ({ value: option.id, label: option.label }))}
            onChange={setSort}
          />
        }
      />

      {stats.length === 0 ? (
        <EmptyState
          icon={<TagIcon className="size-8" aria-hidden />}
          title="Nothing is tagged yet."
          body="Tag a task in Task Manager — from its menu or the detail panel — and its time shows up here."
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {stats.map((stat) => (
              <li
                key={stat.tag}
                className="card rounded-2xl p-4"
              >
                <div className="flex items-center gap-3">
                  {editing === stat.tag ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <label htmlFor={`tag-${stat.tag}`} className="sr-only">
                        Tag name
                      </label>
                      <input
                        id={`tag-${stat.tag}`}
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(stat.tag)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        maxLength={32}
                        className="min-w-0 flex-1 rounded-lg border border-accent bg-surface px-2 py-1 text-sm text-ink"
                      />
                      <button
                        type="button"
                        aria-label={`Save name for ${stat.tag}`}
                        disabled={!isValidTag(draft)}
                        onClick={() => void commitRename(stat.tag)}
                        className="flex size-6 items-center justify-center rounded-full text-accent disabled:opacity-40"
                      >
                        <Check className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Cancel renaming ${stat.tag}`}
                        onClick={() => setEditing(null)}
                        className="flex size-6 items-center justify-center rounded-full text-muted hover:text-ink"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
                        <TagIcon className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">{stat.tag}</span>
                      </span>

                      <span className="flex-1" />

                      <button
                        type="button"
                        aria-label={`Rename ${stat.tag}`}
                        onClick={() => {
                          setDraft(stat.tag)
                          setEditing(stat.tag)
                        }}
                        className="flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${stat.tag} from every task`}
                        onClick={() => {
                          feedback('warning')
                          void ctx.db.removeTag(stat.tag)
                        }}
                        className="flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:text-bad"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
                  <motion.div
                    className="h-full rounded-full bg-accent"
                    initial={false}
                    animate={{ width: `${(stat.trackedMinutes / peak) * 100}%` }}
                    transition={{ type: 'spring', stiffness: 200, damping: 30 }}
                  />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="text-ink">{formatMinutes(stat.trackedMinutes)} tracked</span>
                  <span>
                    {stat.doneCount}/{stat.taskCount} done
                    {stat.completionRate !== null && ` · ${stat.completionRate}%`}
                  </span>
                  <span>typically {formatMinutes(stat.medianMinutes)} each</span>
                  {stat.unestimated > 0 && <span>{stat.unestimated} unsized</span>}

                  <button
                    type="button"
                    aria-expanded={expanded === stat.tag}
                    aria-label={`Show tasks tagged ${stat.tag}`}
                    onClick={() => {
                      feedback('selection')
                      setExpanded(expanded === stat.tag ? null : stat.tag)
                    }}
                    className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors hover:text-accent"
                  >
                    {stat.taskCount} task{stat.taskCount === 1 ? '' : 's'}
                    <ChevronDown
                      className={`size-3 transition-transform ${
                        expanded === stat.tag ? 'rotate-180' : ''
                      }`}
                      aria-hidden
                    />
                  </button>
                </div>

                {expanded === stat.tag && (
                  <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
                    {tasks
                      .filter((task) => task.tags.includes(stat.tag))
                      .map((task) => (
                        <li key={task.id} className="flex items-center gap-2.5">
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${
                              task.status === 'done' ? 'bg-ok' : 'bg-muted'
                            }`}
                            aria-hidden
                          />
                          <span
                            className={`min-w-0 flex-1 truncate text-xs ${
                              task.status === 'done' ? 'text-muted line-through' : 'text-ink'
                            }`}
                          >
                            {task.title}
                          </span>
                          <span className="measure shrink-0 text-[11px] text-muted">
                            {task.plannedFor}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          <p className="text-center text-xs text-muted">
            A task with several tags counts fully under each — so these do not add up
            to your total, and no total is shown.
          </p>
        </>
      )}
    </div>
  )
}
