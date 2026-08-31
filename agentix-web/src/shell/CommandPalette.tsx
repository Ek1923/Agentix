import { AnimatePresence, motion } from 'framer-motion'
import { CornerDownLeft, FileText, ListTodo, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Queries, SearchHit } from '../core/db/queries'
import { registry } from '../core/plugin-host/registry'
import { feedback } from '../ui/feedback'
import { ManifestIcon } from '../ui/icons'
import { transition } from '../ui/tokens'

interface CommandPaletteProps {
  db: Queries
  open: boolean
  onClose: () => void
  onNavigate: (to: string) => void
}

interface Destination {
  id: string
  name: string
  icon: string
}

const SHELL_DESTINATIONS: Destination[] = [
  { id: 'home', name: 'Home', icon: 'Blocks' },
  { id: 'profile', name: 'Profile', icon: 'CheckSquare' },
  { id: 'theme', name: 'Theme', icon: 'Tag' },
  { id: 'settings', name: 'Settings', icon: 'Puzzle' },
]

/**
 * Search and jump, on Ctrl/Cmd+K.
 *
 * The shell owns this rather than any plugin: it searches across everything and
 * navigates anywhere, which is precisely the thing no single plugin may know
 * about. It reads through the same `Queries` object plugins get.
 *
 * The body is a separate component that only exists while the palette is open, so
 * its state resets by unmounting rather than by an effect that clears it.
 */
export function CommandPalette({ db, open, onClose, onNavigate }: CommandPaletteProps) {
  return (
    <AnimatePresence>
      {open && <PaletteBody db={db} onClose={onClose} onNavigate={onNavigate} />}
    </AnimatePresence>
  )
}

function PaletteBody({
  db,
  onClose,
  onNavigate,
}: Omit<CommandPaletteProps, 'open'>) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [active, setActive] = useState(0)

  const destinations = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const all = [
      ...registry.map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        icon: p.manifest.icon,
      })),
      ...SHELL_DESTINATIONS,
    ]
    return needle === '' ? all : all.filter((d) => d.name.toLowerCase().includes(needle))
  }, [query])

  // Searching is synchronising with an external store, which is what an effect is
  // for. The result is transient, so a live subscription would be the wrong tool.
  useEffect(() => {
    let cancelled = false
    void db.search(query).then((found) => {
      if (!cancelled) setHits(found)
    })
    return () => {
      cancelled = true
    }
  }, [db, query])

  const rows = [
    ...destinations.map((d) => ({ kind: 'go' as const, key: `go-${d.id}`, destination: d })),
    ...hits.map((hit) => ({ kind: 'hit' as const, key: `${hit.kind}-${hit.id}`, hit })),
  ]

  // Clamped while rendering rather than corrected by an effect: the list shrinks
  // as you type, and a stored index would be briefly out of range.
  const activeIndex = rows.length === 0 ? 0 : Math.min(active, rows.length - 1)

  function choose(index: number) {
    const row = rows[index]
    if (!row) return

    feedback('light')
    if (row.kind === 'go') onNavigate(row.destination.id)
    // A hit is a place to look, not a thing to open: tasks live in Task Manager
    // and notes in Note Taker, so the palette takes you to the right plugin.
    else onNavigate(row.hit.kind === 'task' ? 'task-manager' : 'note-taker')
    onClose()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (rows.length === 0) {
      if (e.key === 'Escape') onClose()
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((activeIndex + 1) % rows.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((activeIndex - 1 + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(activeIndex)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transition.tap}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Search and jump"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        className="w-full max-w-lg overflow-hidden card rounded-2xl shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <label htmlFor="paletteQuery" className="sr-only">
            Search tasks, notes and plugins
          </label>
          <input
            id="paletteQuery"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search tasks, notes, or jump to a plugin"
            className="min-w-0 flex-1 bg-transparent py-3.5 text-sm text-ink placeholder:text-muted focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">
            Esc
          </kbd>
        </div>

        <ul className="agentix-scroll max-h-80 overflow-y-auto p-1.5" role="listbox">
          {rows.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-muted">Nothing matches that.</li>
          ) : (
            rows.map((row, index) => (
              <li key={row.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    index === activeIndex ? 'bg-accent/10' : 'hover:bg-surface'
                  }`}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface text-accent">
                    {row.kind === 'go' ? (
                      <ManifestIcon name={row.destination.icon} className="size-3.5" />
                    ) : row.hit.kind === 'task' ? (
                      <ListTodo className="size-3.5" aria-hidden />
                    ) : (
                      <FileText className="size-3.5" aria-hidden />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {row.kind === 'go' ? row.destination.name : row.hit.title}
                    </span>
                    <span className="block truncate text-[11px] text-muted">
                      {row.kind === 'go' ? 'Go to' : row.hit.subtitle}
                    </span>
                  </span>

                  {index === activeIndex && (
                    <CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden />
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </motion.div>
    </motion.div>
  )
}
