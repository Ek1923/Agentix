import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, ChevronLeft, ChevronRight, Repeat } from 'lucide-react'
import { useState } from 'react'
import type { PluginContext } from '../../core/plugin-host/types'
import { useSettings } from '../../core/settings/store'
import { Button } from '../../ui/components/Button'
import { EmptyState } from '../../ui/components/EmptyState'
import { transition } from '../../ui/tokens'
import { sortForDay } from '../task-manager/logic/tasks'
import { formatDuration, totalDurationMs } from '../task-manager/logic/time'
import { useTicker } from '../task-manager/useTicker'
import { WeekStrip } from './components/WeekStrip'
import {
  dayLabel,
  isPast,
  monthLabel,
  shiftDay,
  todayKey,
  weekOf,
  type DayKey,
} from './logic/days'

export function Agenda({ ctx }: { ctx: PluginContext }) {
  const today = todayKey()
  const [selected, setSelected] = useState<DayKey>(today)
  const weekStartsOn = useSettings((s) => s.weekStartsOn)

  const week = weekOf(selected, weekStartsOn)

  const tasks = useLiveQuery(() => ctx.db.listTasksByDay(selected), [selected])

  // One range query covers the whole strip, so the dots do not cost seven reads.
  const weekTasks = useLiveQuery(
    () => ctx.db.listTasksInRange(week[0]!, week[6]!),
    [week[0], week[6]],
    [],
  )

  const sessions = useLiveQuery(
    async () => {
      const forDay = await ctx.db.listTasksByDay(selected)
      return ctx.db.listSessionsForTasks(forDay.map((t) => t.id))
    },
    [selected],
    [],
  )

  // Only ticks if a timer happens to be running on one of this day's tasks.
  const nowIso = useTicker(sessions.some((s) => s.endedAt === null))

  if (tasks === undefined) return null

  const countsByDay = new Map<DayKey, number>()
  for (const task of weekTasks) {
    if (task.status === 'done') continue
    countsByDay.set(task.plannedFor, (countsByDay.get(task.plannedFor) ?? 0) + 1)
  }

  const ordered = sortForDay(tasks)
  const done = ordered.filter((t) => t.status === 'done').length
  const trackedMs = totalDurationMs(sessions, nowIso)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => setSelected(shiftDay(selected, -7))}
          className="flex size-9 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-muted hover:text-ink"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>

        <div className="text-center">
          <div className="text-sm font-semibold text-ink">{monthLabel(selected)}</div>
          {selected !== today && (
            <button
              type="button"
              onClick={() => setSelected(today)}
              className="text-xs text-accent hover:underline"
            >
              Jump to today
            </button>
          )}
        </div>

        <button
          type="button"
          aria-label="Next week"
          onClick={() => setSelected(shiftDay(selected, 7))}
          className="flex size-9 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-muted hover:text-ink"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>

      <WeekStrip
        days={week}
        selected={selected}
        today={today}
        countsByDay={countsByDay}
        onSelect={setSelected}
      />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-base text-ink">{dayLabel(selected, today)}</h2>
        {ordered.length > 0 && (
          <p className="text-xs text-muted">
            {done} of {ordered.length} done
            {trackedMs > 0 && ` · ${formatDuration(trackedMs)} tracked`}
          </p>
        )}
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="size-8" aria-hidden />}
          title={`Nothing planned for ${dayLabel(selected, today).toLowerCase()}.`}
          body="Tasks land here on the day they are planned for. Add them in Task Manager, or move one from another day."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {ordered.map((task) => (
              <motion.li
                key={task.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={transition.tap}
                className="flex items-center gap-3 card rounded-xl px-4 py-3"
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    task.status === 'done'
                      ? 'bg-ok'
                      : task.status === 'active'
                        ? 'bg-accent'
                        : isPast(selected, today)
                          ? 'bg-bad'
                          : 'bg-muted'
                  }`}
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-sm font-medium ${
                      task.status === 'done' ? 'text-muted line-through' : 'text-ink'
                    }`}
                  >
                    {task.title}
                  </div>
                  {task.estimateMin !== null && (
                    <div className="mt-0.5 text-xs text-muted">est {task.estimateMin}m</div>
                  )}
                </div>

                {/*
                  A routine belongs to its day by definition, so it says what it is
                  instead of offering to be moved off the day it exists for.
                */}
                {task.habitId !== null ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                    <Repeat className="size-3 shrink-0" aria-hidden />
                    Routine
                  </span>
                ) : (
                <>
                {/*
                  Moving a task is the whole point of a day view — this is how a
                  task "lands on the right day" after it was planned on the wrong one.
                */}
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={`Move "${task.title}" to the previous day`}
                    onClick={() =>
                      void ctx.db.updateTask(task.id, {
                        plannedFor: shiftDay(task.plannedFor, -1),
                      })
                    }
                    className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:text-accent"
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move "${task.title}" to the next day`}
                    onClick={() =>
                      void ctx.db.updateTask(task.id, {
                        plannedFor: shiftDay(task.plannedFor, 1),
                      })
                    }
                    className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:text-accent"
                  >
                    <ChevronRight className="size-4" aria-hidden />
                  </button>
                </div>
                </>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <Button variant="ghost" onClick={() => ctx.navigate('task-manager')}>
        Open Task Manager
      </Button>
    </div>
  )
}
