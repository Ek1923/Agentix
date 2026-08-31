import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Flame, Pause, Play, Plus, Repeat, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { shiftDay } from '../../core/dates'
import type { PluginContext } from '../../core/plugin-host/types'
import { backgroundCss, BACKGROUNDS, resolveBackground } from '../../ui/avatars'
import { EmptyState } from '../../ui/components/EmptyState'
import { feedback } from '../../ui/feedback'
import { transition } from '../../ui/tokens'
import {
  describeCadence,
  isValidHabitTitle,
  progressFor,
  splitByPaused,
  summarise,
  WEEKDAY_LABELS,
} from './logic/streaks'

/** Long enough to show a pattern in a strip that still fits a card. */
const WINDOW_DAYS = 21

export function Habits({ ctx }: { ctx: PluginContext }) {
  const today = ctx.db.todayLocal()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [days, setDays] = useState<number[]>([])

  // Includes paused ones: they are listed separately rather than hidden, so
  // resuming is one click and not a hunt through the trash.
  const habits = useLiveQuery(() => ctx.db.listHabits(true), [], [])
  const logs = useLiveQuery(
    () => ctx.db.listHabitLogs(shiftDay(today, -365), today),
    [today],
    [],
  )

  const { active, paused } = splitByPaused(habits)
  const progress = active.map((habit) => progressFor(habit, logs, today, WINDOW_DAYS))
  const totals = summarise(progress)

  async function addHabit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidHabitTitle(title)) return

    const colorId = BACKGROUNDS[habits.length % BACKGROUNDS.length]!.id
    await ctx.db.createHabit(title.trim(), days, null, colorId)
    setTitle('')
    setDays([])
    setAdding(false)
    feedback('light')
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-base text-ink">Routines</h2>
        {habits.length > 0 && (
          <p className="text-xs text-muted">
            {totals.doneToday} of {totals.dueToday} due today
            {totals.adherence !== null && ` · ${totals.adherence}% kept over ${WINDOW_DAYS} days`}
          </p>
        )}
      </div>

      {adding ? (
        <motion.form
          onSubmit={addHabit}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition.screen}
          className="flex flex-col gap-4 card rounded-2xl p-4"
        >
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <label htmlFor="habitTitle" className="text-sm font-medium text-ink">
                New routine
              </label>
              <input
                id="habitTitle"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Read for twenty minutes"
                maxLength={80}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
              />
            </div>
            <button
              type="button"
              aria-label="Close the new routine form"
              onClick={() => {
                setAdding(false)
                setTitle('')
                setDays([])
              }}
              className="mt-7 flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Days</span>
            <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, index) => {
                const on = days.includes(index)
                return (
                  <button
                    key={label}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={label}
                    onClick={() => {
                      feedback('selection')
                      setDays((current) =>
                        current.includes(index)
                          ? current.filter((d) => d !== index)
                          : [...current, index],
                      )
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      on
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-line text-muted hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted">
              Pick none for every day — most routines are daily, so that is the default.
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!isValidHabitTitle(title)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface disabled:opacity-40"
            >
              <Plus className="size-4" aria-hidden />
              Add routine
            </button>
          </div>
        </motion.form>
      ) : (
        <button
          type="button"
          onClick={() => {
            feedback('selection')
            setAdding(true)
          }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3.5 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-accent"
        >
          <Plus className="size-4" aria-hidden />
          Add routine
        </button>
      )}

      {active.length === 0 && paused.length === 0 ? (
        <EmptyState
          icon={<Repeat className="size-8" aria-hidden />}
          title="No routines yet."
          body="A routine is a rule, not a task. Add one and the streak follows from whether you kept it."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {progress.map(({ habit, streak, adherence, recent }) => (
              <motion.li
                key={habit.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="flex flex-col gap-3 card rounded-2xl p-4"
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={streak.doneToday}
                    aria-label={`Mark "${habit.title}" ${streak.doneToday ? 'not done' : 'done'} today`}
                    disabled={!streak.dueToday}
                    onClick={() => {
                      feedback(streak.doneToday ? 'light' : 'success')
                      void ctx.db.setHabitDone(habit.id, today, !streak.doneToday)
                    }}
                    style={
                      streak.doneToday
                        ? { backgroundImage: backgroundCss(resolveBackground(habit.colorId)) }
                        : undefined
                    }
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      streak.doneToday
                        ? 'border-transparent text-white'
                        : 'border-muted hover:border-ink'
                    }`}
                  >
                    {streak.doneToday && <Check className="size-3.5" aria-hidden />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-ink">{habit.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {describeCadence(habit)}
                      {!streak.dueToday && ' · not due today'}
                      {adherence !== null && ` · ${adherence}% kept`}
                    </p>
                  </div>

                  {streak.current > 0 && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn/15 px-2.5 py-1 text-xs font-semibold text-warn"
                      title={`Longest run: ${streak.longest}`}
                    >
                      <Flame className="size-3.5" aria-hidden />
                      {streak.current}
                    </span>
                  )}

                  <button
                    type="button"
                    aria-label={`Pause "${habit.title}"`}
                    onClick={() => {
                      feedback('light')
                      void ctx.db.updateHabit(habit.id, {
                        archivedAt: new Date().toISOString(),
                      })
                    }}
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
                  >
                    <Pause className="size-3.5" aria-hidden />
                  </button>

                  <button
                    type="button"
                    aria-label={`Delete "${habit.title}"`}
                    onClick={() => {
                      feedback('warning')
                      void ctx.db.deleteHabit(habit.id)
                    }}
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted opacity-0 transition-all hover:text-bad focus-visible:opacity-100 group-hover:opacity-100 sm:opacity-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>

                {/*
                  The last three weeks. A day the habit was not due is a faint
                  tick rather than a gap, so the rhythm of a weekday-only routine
                  is still readable.
                */}
                <div className="flex gap-[3px]" aria-hidden>
                  {recent.map((entry) => (
                    <span
                      key={entry.day}
                      title={entry.day}
                      style={
                        entry.done
                          ? { backgroundImage: backgroundCss(resolveBackground(habit.colorId)) }
                          : undefined
                      }
                      className={`h-5 flex-1 rounded-sm ${
                        entry.done ? '' : entry.due ? 'bg-line' : 'bg-line/40'
                      }`}
                    />
                  ))}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {paused.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="eyebrow">Paused</h3>
          <p className="text-xs text-muted">
            Not due, not counted, and the history is kept. Resuming picks up where
            the streak left off rather than starting from zero.
          </p>

          <ul className="mt-1 flex flex-col gap-2">
            {paused.map((habit) => (
              <li
                key={habit.id}
                className="flex items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-muted">
                  {habit.title}
                </span>
                <button
                  type="button"
                  aria-label={`Resume "${habit.title}"`}
                  onClick={() => {
                    feedback('success')
                    void ctx.db.updateHabit(habit.id, { archivedAt: null })
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  <Play className="size-3.5" aria-hidden />
                  Resume
                </button>
                <button
                  type="button"
                  aria-label={`Delete "${habit.title}"`}
                  onClick={() => {
                    feedback('warning')
                    void ctx.db.deleteHabit(habit.id)
                  }}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-bad"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
