import { useSettings } from '../../core/settings/store'
import { Card } from '../../ui/components/Card'
import { SegmentedControl } from '../../ui/components/SegmentedControl'
import { feedback } from '../../ui/feedback'

const AUTO_STOP = [
  { value: 0, label: 'Never', ariaLabel: 'Never stop a running timer' },
  { value: 4, label: '4h', ariaLabel: 'Stop a running timer after 4 hours' },
  { value: 8, label: '8h', ariaLabel: 'Stop a running timer after 8 hours' },
  { value: 12, label: '12h', ariaLabel: 'Stop a running timer after 12 hours' },
] as const

/**
 * The settings that were previously decisions made for the user.
 *
 * Each of these was hardcoded somewhere: the week opened on Monday, clocks were
 * 24-hour, new tasks started at Normal, and a forgotten timer ran forever. None
 * of those are universal, so each is now a choice with a sensible default.
 */
export function Preferences() {
  const weekStartsOn = useSettings((s) => s.weekStartsOn)
  const clockFormat = useSettings((s) => s.clockFormat)
  const defaultPriority = useSettings((s) => s.defaultPriority)
  const autoStopHours = useSettings((s) => s.autoStopHours)
  const syncOnOpen = useSettings((s) => s.syncOnOpen)

  const setWeekStartsOn = useSettings((s) => s.setWeekStartsOn)
  const setClockFormat = useSettings((s) => s.setClockFormat)
  const setDefaultPriority = useSettings((s) => s.setDefaultPriority)
  const setAutoStopHours = useSettings((s) => s.setAutoStopHours)
  const setSyncOnOpen = useSettings((s) => s.setSyncOnOpen)

  return (
    <div className="flex flex-col gap-6">
      <Card title="Dates and times" description="Regional habits, not universal truths.">
        <div className="flex flex-col gap-5">
          <Row
            label="Week starts on"
            hint="Changes the Agenda strip."
            control={
              <SegmentedControl
                label="Week starts on"
                value={weekStartsOn}
                segments={[
                  { value: 1, label: 'Monday' },
                  { value: 0, label: 'Sunday' },
                ]}
                onChange={setWeekStartsOn}
              />
            }
          />

          <Row
            label="Clock"
            hint="Used for clock-in and clock-out times."
            control={
              <SegmentedControl
                label="Clock"
                value={clockFormat}
                segments={[
                  { value: '24h', label: '24h' },
                  { value: '12h', label: '12h' },
                ]}
                onChange={setClockFormat}
              />
            }
          />
        </div>
      </Card>

      <Card title="Tasks and the timer">
        <div className="flex flex-col gap-5">
          <Row
            label="New tasks start at"
            hint="Where the priority control opens in the composer."
            control={
              <SegmentedControl
                label="Default priority"
                value={defaultPriority}
                segments={[
                  { value: 0, label: 'Normal' },
                  { value: 1, label: 'High' },
                  { value: 2, label: 'Urgent' },
                ]}
                onChange={setDefaultPriority}
              />
            }
          />

          <Row
            label="Stop a forgotten timer after"
            hint="A timer left running overnight adds fourteen hours to a task and skews every estimate that reads it."
            control={
              <SegmentedControl
                label="Stop a forgotten timer after"
                value={autoStopHours}
                segments={AUTO_STOP.map((option) => ({ ...option }))}
                onChange={setAutoStopHours}
              />
            }
          />
        </div>
      </Card>

      <Card title="Sync behaviour">
        <Row
          label="Sync when the app opens"
          hint="Only when an account is signed in. Nothing is sent without one."
          control={
            <Toggle
              label="Sync when the app opens"
              checked={syncOnOpen}
              onChange={setSyncOnOpen}
            />
          }
        />
      </Card>
    </div>
  )
}

function Row({
  label,
  hint,
  control,
}: {
  label: string
  hint?: string
  control: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-sm">
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p>}
      </div>
      {control}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        feedback('selection')
        onChange(!checked)
      }}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-line'
      }`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-surface transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}
