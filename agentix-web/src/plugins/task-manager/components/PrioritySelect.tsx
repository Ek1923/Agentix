import { feedback } from '../../../ui/feedback'
import { PRIORITY_LABELS } from '../logic/tasks'

type Priority = 0 | 1 | 2

interface PrioritySelectProps {
  value: Priority
  onChange: (value: Priority) => void
  /** True in the task panel, where the row has width to fill. */
  fill?: boolean
}

/** Selected styling per level. Normal is deliberately colourless. */
const SELECTED: Record<Priority, string> = {
  0: 'border-line bg-surface text-muted',
  1: 'border-warn/50 bg-warn/10 text-warn',
  2: 'border-bad/50 bg-bad/10 text-bad',
}

/**
 * Normal / High / Urgent.
 *
 * The composer and the task panel each had their own copy, and they had drifted:
 * different padding, and one of them lost the tinted background on selection. The
 * same choice should not look like two different controls depending on where you
 * make it.
 */
export function PrioritySelect({ value, onChange, fill = false }: PrioritySelectProps) {
  return (
    <div role="radiogroup" aria-label="Priority" className="flex gap-1.5">
      {([0, 1, 2] as const).map((level) => {
        const selected = value === level
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={PRIORITY_LABELS[level]}
            onClick={() => {
              if (selected) return
              feedback('selection')
              onChange(level)
            }}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              fill ? 'flex-1' : ''
            } ${selected ? SELECTED[level] : 'border-line text-muted hover:text-ink'}`}
          >
            {PRIORITY_LABELS[level]}
          </button>
        )
      })}
    </div>
  )
}
