import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import type { Queries } from '../core/db/queries'
import { useSettings } from '../core/settings/store'
import { transition } from '../ui/tokens'

interface TodayHeroProps {
  db: Queries
}

function greeting(hour: number): string {
  if (hour < 6) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? ''
}

function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes)
  if (rounded < 60) return `${rounded}m`
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`
}

/**
 * The opening of the app.
 *
 * The home screen used to be a name, a date and a list of grey rows — the first
 * thing you saw was also the least considered. This is the one place the design
 * spends any weight: the day set large in the display face, and the two numbers
 * that answer "how is today going" before you have clicked anything.
 *
 * Both figures are derived live from the same queries the plugins use. Nothing
 * here is stored, so it can never disagree with the board.
 */
export function TodayHero({ db }: TodayHeroProps) {
  const displayName = useSettings((s) => s.displayName)
  const today = db.todayLocal()

  const tasks = useLiveQuery(() => db.listTasksByDay(today), [today], [])
  const sessions = useLiveQuery(
    async () => {
      const forDay = await db.listTasksByDay(today)
      return db.listSessionsForTasks(forDay.map((t) => t.id))
    },
    [today],
    [],
  )

  const now = new Date()
  const done = tasks.filter((task) => task.status === 'done').length
  const trackedMinutes = sessions.reduce((total, session) => {
    const start = Date.parse(session.startedAt)
    const end = session.endedAt === null ? now.getTime() : Date.parse(session.endedAt)
    if (Number.isNaN(start) || Number.isNaN(end)) return total
    return total + Math.max(0, end - start) / 60_000
  }, 0)

  const name = firstName(displayName)
  const percent = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100)

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition.screen}
      className="flex flex-col gap-6"
    >
      <div>
        <p className="eyebrow">{format(now, 'EEEE d MMMM')}</p>
        <h1 className="display mt-2 text-4xl leading-[1.05] text-ink sm:text-5xl">
          {greeting(now.getHours())}
          {name && <span className="text-muted">, {name}</span>}
        </h1>
      </div>

      {/*
        Two figures, and a sentence only when there is something to say. An empty
        day gets an invitation instead of a row of zeroes — a dashboard of noughts
        reads as failure when it only means the day has not started.
      */}
      {tasks.length === 0 && trackedMinutes === 0 ? (
        <p className="max-w-md text-sm leading-relaxed text-muted">
          Nothing planned yet. Open Task Manager and put the first thing down —
          everything else on this screen fills itself in from there.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
          <div>
            <p className="eyebrow">Done today</p>
            <p className="display measure mt-1 text-3xl leading-none text-ink">
              {done}
              <span className="text-muted">/{tasks.length}</span>
            </p>
          </div>

          <div>
            <p className="eyebrow">Tracked</p>
            <p className="display measure mt-1 text-3xl leading-none text-ink">
              {trackedMinutes > 0 ? formatMinutes(trackedMinutes) : '—'}
            </p>
          </div>

          {tasks.length > 0 && (
            <div className="min-w-40 flex-1">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress today"
              >
                <motion.div
                  className="h-full rounded-full bg-accent"
                  initial={{ width: 0 }}
                  animate={{ width: `${percent}%` }}
                  transition={{ type: 'spring', stiffness: 160, damping: 28 }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </motion.section>
  )
}
