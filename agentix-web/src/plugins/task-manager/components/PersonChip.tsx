import type { Person } from '../../../core/db/types'
import { backgroundCss, initialsOf, resolveBackground } from '../../../ui/avatars'

interface PersonChipProps {
  person: Person
  size?: number
  showName?: boolean
}

/** A tagged person, drawn the same way a profile avatar is. */
export function PersonChip({ person, size = 22, showName = false }: PersonChipProps) {
  const background = resolveBackground(person.colorId)

  const dot = (
    <span
      style={{
        width: size,
        height: size,
        backgroundImage: backgroundCss(background),
        color: background.ink === 'light' ? '#ffffff' : '#111827',
        fontSize: Math.round(size * 0.4),
      }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none"
      title={person.name}
    >
      {initialsOf(person.name)}
    </span>
  )

  if (!showName) return dot

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface py-0.5 pl-0.5 pr-2.5">
      {dot}
      <span className="truncate text-[11px] text-ink">{person.name}</span>
    </span>
  )
}

interface PersonStackProps {
  people: Person[]
  max?: number
}

/** Overlapping avatars, with a "+N" when there are more than fit. */
export function PersonStack({ people, max = 3 }: PersonStackProps) {
  if (people.length === 0) return null

  const shown = people.slice(0, max)
  const overflow = people.length - shown.length

  return (
    <span className="flex items-center" aria-label={people.map((p) => p.name).join(', ')}>
      {shown.map((person, i) => (
        <span key={person.id} className={i === 0 ? '' : '-ml-1.5'}>
          <PersonChip person={person} size={20} />
        </span>
      ))}
      {overflow > 0 && (
        <span className="-ml-1.5 inline-flex size-5 items-center justify-center rounded-full border border-line bg-raised text-[10px] font-semibold text-muted">
          +{overflow}
        </span>
      )}
    </span>
  )
}
