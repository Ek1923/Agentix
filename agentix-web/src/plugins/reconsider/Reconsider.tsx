import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import type { PluginContext } from '../../core/plugin-host/types'
import { EmptyState } from '../../ui/components/EmptyState'
import { feedback } from '../../ui/feedback'
import { PageHeader } from '../../ui/components/PageHeader'
import { SegmentedControl } from '../../ui/components/SegmentedControl'
import { formatDuration } from '../task-manager/logic/time'
import { SuggestionCard } from './components/SuggestionCard'
import {
  bulkActionFor,
  buildSuggestions,
  countSuggestions,
  groupByKind,
  tomorrowOf,
  type SuggestionKind,
} from './logic/suggestions'

/** How far back to look. The user's choice, because "recent" is personal. */
const WINDOWS = [7, 14, 30] as const
type Window = (typeof WINDOWS)[number]

export function Reconsider({ ctx }: { ctx: PluginContext }) {
  const today = ctx.db.todayLocal()
  const [days, setDays] = useState<Window>(14)

  const tasks = useLiveQuery(() => ctx.db.listRecentTasks(days), [days])
  const sessions = useLiveQuery(
    async () => {
      const recent = await ctx.db.listRecentTasks(days)
      return ctx.db.listSessionsForTasks(recent.map((t) => t.id))
    },
    [days],
    [],
  )

  if (tasks === undefined) return null

  // Recomputed from live data on every render — nothing is stored, so nothing
  // can go stale or disagree with the board.
  const suggestions = buildSuggestions(tasks, sessions, today, new Date().toISOString())
  const counts = countSuggestions(suggestions)
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const groups = groupByKind(suggestions)

  async function moveGroup(kind: SuggestionKind, target: 'today' | 'tomorrow') {
    const day = target === 'today' ? today : tomorrowOf(today)
    // Sequential rather than parallel: each write bumps updatedAt, and a burst of
    // concurrent writes to the same table is how Dexie transactions start
    // tripping over each other.
    for (const suggestion of groups[kind]) {
      await ctx.db.updateTask(suggestion.taskId, { plannedFor: day })
    }
    feedback('success')
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Unfinished"
        meta={
          counts.total > 0
            ? `${counts.total} to reconsider${
                counts.strandedMin > 0
                  ? ` · ${formatDuration(counts.strandedMin * 60_000)} already invested`
                  : ''
              }`
            : undefined
        }
        trailing={
          <SegmentedControl
            label="Look back"
            value={days}
            segments={WINDOWS.map((window) => ({
              value: window,
              label: `${window}d`,
              ariaLabel: `Last ${window} days`,
            }))}
            onChange={setDays}
          />
        }
      />

      {/*
        One decision instead of twelve. A review screen that needs a dozen clicks
        to act on is a review screen that stops being opened.
      */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(['resume', 'reschedule'] as const).map((kind) => {
            const action = bulkActionFor(kind, groups[kind].length)
            if (action === null) return null

            return (
              <button
                key={kind}
                type="button"
                onClick={() => void moveGroup(kind, action.target)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
              >
                {action.label}
              </button>
            )
          })}
        </div>
      )}

      {suggestions.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-8 text-ok" aria-hidden />}
          title="Nothing left behind."
          body={`Nothing from the last ${days} days is still open. Today's work lives in Task Manager.`}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {suggestions.map((suggestion) => {
              const task = taskById.get(suggestion.taskId)
              if (!task) return null

              return (
                <SuggestionCard
                  key={suggestion.taskId}
                  suggestion={suggestion}
                  task={task}
                  onMoveToToday={async () => {
                    await ctx.db.updateTask(task.id, { plannedFor: today })
                  }}
                  onMoveToTomorrow={async () => {
                    await ctx.db.updateTask(task.id, { plannedFor: tomorrowOf(today) })
                  }}
                  // setTaskDone lives in the query layer so status, completedAt,
                  // the board column and any running timer cannot drift apart.
                  onComplete={() => ctx.db.setTaskDone(task.id, true)}
                  onDrop={() => ctx.db.deleteTask(task.id)}
                />
              )
            })}
          </AnimatePresence>
        </ul>
      )}

      {counts.total > 0 && (
        <p className="text-center text-xs text-muted">
          Moving something forward changes the day it is planned for — nothing is
          rewritten, and the time already tracked stays with it.
        </p>
      )}
    </div>
  )
}
