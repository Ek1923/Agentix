import { Tag as TagIcon, X } from 'lucide-react'
import { useState } from 'react'
import { feedback } from '../../../ui/feedback'
import { addTag, isValidTag, normaliseTag, removeTagFrom } from '../../tags/logic/tags'

interface TagEditorProps {
  tags: string[]
  /** Tags already in use elsewhere, offered as suggestions. */
  suggestions: string[]
  onChange: (tags: string[]) => Promise<void>
}

/**
 * Tag editing on a task.
 *
 * The normalisation rules live in the Tags plugin's logic, not here: a tag typed
 * on a card and a tag typed anywhere else must end up identical, or the Tags
 * breakdown quietly splits one project into two.
 */
export function TagEditor({ tags, suggestions, onChange }: TagEditorProps) {
  const [draft, setDraft] = useState('')

  const unused = suggestions.filter((tag) => !tags.includes(tag)).slice(0, 6)

  async function commit() {
    const next = addTag(tags, draft)
    setDraft('')
    if (next !== tags) {
      await onChange(next)
      feedback('light')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-accent/10 py-0.5 pl-2 pr-1 text-[11px] text-accent"
          >
            <TagIcon className="size-3 shrink-0" aria-hidden />
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => {
                feedback('selection')
                void onChange(removeTagFrom(tags, tag))
              }}
              className="flex size-4 items-center justify-center rounded-full transition-colors hover:bg-accent/20"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}

        <label htmlFor="tagInput" className="sr-only">
          Add a tag
        </label>
        <input
          id="tagInput"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter and comma both commit — people type tags both ways.
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              void commit()
            }
            if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
              void onChange(removeTagFrom(tags, tags[tags.length - 1]!))
            }
          }}
          onBlur={() => {
            if (isValidTag(draft)) void commit()
          }}
          placeholder={tags.length === 0 ? 'Add a tag' : 'Add another'}
          maxLength={32}
          className="min-w-24 flex-1 bg-transparent py-1 text-xs text-ink placeholder:text-muted focus:outline-none"
        />
      </div>

      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">Used before:</span>
          {unused.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => {
                feedback('selection')
                void onChange(addTag(tags, tag))
              }}
              className="rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-accent hover:text-accent"
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {draft.trim() !== '' && normaliseTag(draft) === null && (
        <p className="text-[11px] text-bad">
          A tag needs at least one character and at most 32.
        </p>
      )}
    </div>
  )
}
