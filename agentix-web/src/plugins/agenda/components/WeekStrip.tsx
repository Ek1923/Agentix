import { motion } from 'framer-motion'
import { transition } from '../../../ui/tokens'
import {
  dayOfMonth,
  isToday,
  isWeekend,
  weekdayShort,
  type DayKey,
} from '../logic/days'

interface WeekStripProps {
  days: DayKey[]
  selected: DayKey
  today: DayKey
  /** How many open tasks sit on each day, for the dot under the date. */
  countsByDay: Map<DayKey, number>
  onSelect: (day: DayKey) => void
}

export function WeekStrip({
  days,
  selected,
  today,
  countsByDay,
  onSelect,
}: WeekStripProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Day"
      className="agentix-scroll flex gap-2 overflow-x-auto pb-1"
    >
      {days.map((day) => {
        const active = day === selected
        const count = countsByDay.get(day) ?? 0

        return (
          <motion.button
            key={day}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={day}
            onClick={() => onSelect(day)}
            whileTap={{ scale: 0.95 }}
            transition={transition.tap}
            className={`flex min-w-[3.25rem] flex-1 flex-col items-center gap-1 rounded-xl border px-2 py-2.5 transition-colors ${
              active
                ? 'border-accent bg-accent/10'
                : 'border-line bg-raised hover:border-muted'
            }`}
          >
            <span
              className={`text-[11px] uppercase tracking-wide ${
                isWeekend(day) ? 'text-muted/70' : 'text-muted'
              }`}
            >
              {weekdayShort(day)}
            </span>
            <span
              className={`text-sm font-semibold ${
                active ? 'text-accent' : isToday(day, today) ? 'text-ink' : 'text-ink/80'
              }`}
            >
              {dayOfMonth(day)}
            </span>
            {/*
              A dot, not a number: the strip answers "is there anything here",
              and a count would compete with the date for the same small space.
            */}
            <span
              className={`size-1.5 rounded-full ${
                count > 0 ? (active ? 'bg-accent' : 'bg-muted') : 'bg-transparent'
              }`}
              aria-hidden
            />
          </motion.button>
        )
      })}
    </div>
  )
}
