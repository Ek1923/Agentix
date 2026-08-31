import { Check, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import type { Person } from '../../../core/db/types'
import { BACKGROUNDS } from '../../../ui/avatars'
import { feedback } from '../../../ui/feedback'
import { PersonChip } from './PersonChip'

interface PeoplePickerProps {
  people: Person[]
  selectedIds: string[]
  onToggle: (personId: string) => void
  onCreate: (name: string, colorId: string) => Promise<void>
}

/** Cycles the palette so consecutive people are visually distinct without asking. */
function nextColorId(count: number): string {
  return BACKGROUNDS[count % BACKGROUNDS.length]!.id
}

export function PeoplePicker({
  people,
  selectedIds,
  onToggle,
  onCreate,
}: PeoplePickerProps) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '') return

    await onCreate(trimmed, nextColorId(people.length))
    setName('')
    setAdding(false)
    feedback('light')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {people.map((person) => {
          const selected = selectedIds.includes(person.id)
          return (
            <button
              key={person.id}
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={person.name}
              onClick={() => {
                feedback('selection')
                onToggle(person.id)
              }}
              className={`inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition-colors ${
                selected
                  ? 'border-accent bg-accent/10'
                  : 'border-line bg-surface hover:border-muted'
              }`}
            >
              <PersonChip person={person} size={22} />
              <span className="text-xs text-ink">{person.name}</span>
              {selected && <Check className="size-3 text-accent" aria-hidden />}
            </button>
          )
        })}

        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <UserPlus className="size-3.5" aria-hidden />
            Add person
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={submit} className="flex items-center gap-2">
          <label htmlFor="personName" className="sr-only">
            Person name
          </label>
          <input
            id="personName"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Their name"
            maxLength={60}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={name.trim() === ''}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-40"
          >
            Add
          </button>
          <button
            type="button"
            aria-label="Cancel adding a person"
            onClick={() => {
              setAdding(false)
              setName('')
            }}
            className="flex size-7 items-center justify-center rounded-full text-muted hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </form>
      )}

      {people.length === 0 && !adding && (
        <p className="text-xs text-muted">
          Nobody added yet. People you add here stay on this device.
        </p>
      )}
    </div>
  )
}
