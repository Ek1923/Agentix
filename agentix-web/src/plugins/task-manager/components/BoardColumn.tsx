import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Palette, Pencil, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Bucket } from '../../../core/db/types'
import { backgroundCss, BACKGROUNDS, resolveBackground } from '../../../ui/avatars'
import { Menu, type MenuGroup } from '../../../ui/components/Menu'
import { feedback } from '../../../ui/feedback'
import { isValidBucketName } from '../logic/board'

interface BoardColumnProps {
  bucket: Bucket
  count: number
  isDragging: boolean
  /** False when this is the last column, which cannot be removed. */
  canDelete: boolean
  canMoveLeft: boolean
  canMoveRight: boolean
  onDropTask: (taskId: string, bucketId: string) => void
  onRename: (name: string) => Promise<void>
  onRecolour: (colorId: string) => Promise<void>
  onMove: (direction: -1 | 1) => Promise<void>
  onDelete: () => Promise<void>
  children: ReactNode
}

/** The column's dot, drawn from the same palette profiles and people use. */
function ColumnDot({ colorId, size = 8 }: { colorId: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size, backgroundImage: backgroundCss(resolveBackground(colorId)) }}
      className="inline-block shrink-0 rounded-full"
      aria-hidden
    />
  )
}

export function BoardColumn({
  bucket,
  count,
  isDragging,
  canDelete,
  canMoveLeft,
  canMoveRight,
  onDropTask,
  onRename,
  onRecolour,
  onMove,
  onDelete,
  children,
}: BoardColumnProps) {
  const [over, setOver] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bucket.name)

  const valid = isValidBucketName(name)

  async function save() {
    if (!valid) return
    const trimmed = name.trim()
    if (trimmed !== bucket.name) await onRename(trimmed)
    setEditing(false)
    feedback('light')
  }

  const groups: MenuGroup[] = [
    {
      items: [
        {
          id: 'rename',
          label: 'Rename column',
          icon: <Pencil className="size-4" aria-hidden />,
          onSelect: () => {
            setName(bucket.name)
            setEditing(true)
          },
        },
      ],
    },
    {
      label: 'Order',
      items: [
        ...(canMoveLeft
          ? [
              {
                id: 'left',
                label: 'Move left',
                icon: <ArrowLeft className="size-4" aria-hidden />,
                onSelect: () => void onMove(-1),
              },
            ]
          : []),
        ...(canMoveRight
          ? [
              {
                id: 'right',
                label: 'Move right',
                icon: <ArrowRight className="size-4" aria-hidden />,
                onSelect: () => void onMove(1),
              },
            ]
          : []),
      ],
    },
    {
      label: 'Colour',
      items: BACKGROUNDS.map((background) => ({
        id: background.id,
        label: background.label,
        selected: background.id === bucket.colorId,
        icon: <ColumnDot colorId={background.id} size={14} />,
        onSelect: () => void onRecolour(background.id),
      })),
    },
    ...(canDelete
      ? [
          {
            items: [
              {
                id: 'delete',
                label: 'Delete column',
                icon: <Trash2 className="size-4" aria-hidden />,
                danger: true,
                onSelect: () => {
                  feedback('warning')
                  void onDelete()
                },
              },
            ],
          },
        ]
      : []),
  ].filter((group) => group.items.length > 0)

  return (
    <section
      onDragOver={(e) => {
        // Without preventDefault the browser refuses the drop entirely.
        e.preventDefault()
        if (!over) {
          setOver(true)
          feedback('selection')
        }
      }}
      onDragLeave={(e) => {
        // Ignore the events fired while crossing child elements.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const taskId = e.dataTransfer.getData('text/plain')
        if (taskId) onDropTask(taskId, bucket.id)
      }}
      aria-label={bucket.name}
      className={`flex min-w-[17rem] flex-1 flex-col rounded-2xl border p-3 transition-colors duration-150 ${
        over
          ? 'border-accent bg-accent/[0.07]'
          : isDragging
            ? 'border-dashed border-line bg-surface/40'
            : 'border-line bg-surface/40'
      }`}
    >
      <header className="mb-3 flex items-center gap-2 px-1">
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <label htmlFor={`bucket-${bucket.id}`} className="sr-only">
              Column name
            </label>
            <input
              id={`bucket-${bucket.id}`}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
                if (e.key === 'Escape') {
                  setName(bucket.name)
                  setEditing(false)
                }
              }}
              maxLength={40}
              className="min-w-0 flex-1 rounded-lg border border-accent bg-surface px-2 py-1 text-sm font-semibold text-ink"
            />
            <button
              type="button"
              aria-label={`Save name for ${bucket.name}`}
              onClick={() => void save()}
              disabled={!valid}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-accent disabled:opacity-40"
            >
              <Check className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Cancel renaming ${bucket.name}`}
              onClick={() => {
                setName(bucket.name)
                setEditing(false)
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <ColumnDot colorId={bucket.colorId} />
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
              {bucket.name}
            </h3>
            <span className="text-xs font-medium tabular-nums text-muted">{count}</span>
            <Menu label={`Column actions for ${bucket.name}`} groups={groups} />
          </>
        )}
      </header>

      <ul className="agentix-scroll flex max-h-[26rem] flex-col gap-2.5 overflow-y-auto pr-0.5">
        <AnimatePresence initial={false} mode="popLayout">
          {children}
        </AnimatePresence>
      </ul>

      {count === 0 && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="px-1 py-6 text-center text-xs text-muted"
        >
          {over ? 'Drop here' : 'Nothing here yet.'}
        </motion.p>
      )}
    </section>
  )
}

interface AddColumnProps {
  onCreate: (name: string) => Promise<void>
}

export function AddColumn({ onCreate }: AddColumnProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const valid = isValidBucketName(name)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    await onCreate(name.trim())
    setName('')
    setOpen(false)
    feedback('light')
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          feedback('selection')
          setOpen(true)
        }}
        className="flex min-w-[11rem] shrink-0 items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-4 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-accent"
      >
        <Palette className="size-4" aria-hidden />
        Add column
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="flex min-w-[17rem] shrink-0 flex-col gap-2 rounded-2xl border border-accent bg-surface/40 p-3"
    >
      <label htmlFor="newBucket" className="text-xs font-medium text-ink">
        New column
      </label>
      <input
        id="newBucket"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Blocked, Review, Waiting…"
        maxLength={40}
        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-muted"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!valid}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-40"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setName('')
          }}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
