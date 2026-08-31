import { feedback } from '../feedback'

export interface Segment<T extends string | number> {
  value: T
  /** What is drawn. Keep it short — these sit side by side in a pill. */
  label: string
  /** The accessible name, when the visible label is too terse to stand alone. */
  ariaLabel?: string
}

interface SegmentedControlProps<T extends string | number> {
  /** Names the group for screen readers, e.g. "Window" or "Sort by". */
  label: string
  value: T
  segments: ReadonlyArray<Segment<T>>
  onChange: (value: T) => void
}

/**
 * A pill of mutually exclusive options.
 *
 * Six screens had grown their own copy of this: the same radiogroup, the same
 * pill, the same accent-filled selection — with the padding drifting apart by a
 * pixel or two each time. One component means a window selector in Backtest and a
 * sort selector in Tags are recognisably the same control, which is the whole
 * point of a control being recognisable.
 */
export function SegmentedControl<T extends string | number>({
  label,
  value,
  segments,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="card flex shrink-0 gap-1 rounded-full p-1"
    >
      {segments.map((segment) => {
        const selected = segment.value === value
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={segment.ariaLabel ?? segment.label}
            onClick={() => {
              if (selected) return
              feedback('selection')
              onChange(segment.value)
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              selected ? 'bg-accent text-surface' : 'text-muted hover:text-ink'
            }`}
          >
            {segment.label}
          </button>
        )
      })}
    </div>
  )
}
