import { AnimatePresence, motion } from 'framer-motion'
import { MoreVertical } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { feedback } from '../feedback'
import { transition } from '../tokens'

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  /** Marks the item as the current value, for a group that behaves like a choice. */
  selected?: boolean
  /**
   * Offered but not available right now. Always pair with `hint`.
   *
   * The alternative — hiding what you may not do — makes a menu that changes
   * shape depending on who is looking, and leaves someone wondering whether the
   * action exists at all. Showing it greyed with the reason answers that.
   */
  disabled?: boolean
  /** A second line under the label. On a disabled item this is the reason why. */
  hint?: string
}

export interface MenuGroup {
  /** Optional heading above the group. */
  label?: string
  items: MenuItem[]
}

interface MenuProps {
  /** Accessible name for the trigger, e.g. `More actions for "Write the brief"`. */
  label: string
  groups: MenuGroup[]
}

const MENU_WIDTH = 208
/** How long after opening a scroll is assumed to be the opening click's own. */
const SETTLE_MS = 350
const EDGE_GAP = 8

/**
 * A vertical-dots overflow menu.
 *
 * Rendered into a portal on purpose: the board's columns scroll with
 * `overflow-y-auto`, and a normally positioned dropdown inside one is clipped at
 * the column's boundary. A portal plus fixed positioning escapes the clip.
 */
export function Menu({ label, groups }: MenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  /*
    When this menu opened.

    Clicking the trigger focuses it, and a browser scrolls a newly focused element
    into view. On a long page that scroll arrives just after the menu opens and —
    since any scroll closes it — shut the menu again before anyone saw it. The
    menu appeared not to work at all low down the Settings screen.

    So a scroll in the first moments after opening is treated as the opening click's
    own doing rather than as someone scrolling away. Anything later still closes it.
  */
  const openedAt = useRef(0)

  const open = anchor !== null

  useEffect(() => {
    if (!open) return

    const close = () => setAnchor(null)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        triggerRef.current?.focus()
      }
    }
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      close()
    }

    // The anchor rect is captured once, so any scroll or resize invalidates it.
    // Closing is honest; re-measuring mid-scroll would make the menu chase the card.
    const onScroll = () => {
      if (Date.now() - openedAt.current < SETTLE_MS) return
      close()
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function toggle() {
    if (open) {
      setAnchor(null)
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      feedback('selection')
      openedAt.current = Date.now()
      setAnchor(rect)
    }
  }

  // Flip above the trigger when there is not enough room below it.
  const below = anchor === null || anchor.bottom < window.innerHeight * 0.62
  const style: React.CSSProperties =
    anchor === null
      ? {}
      : {
          position: 'fixed',
          width: MENU_WIDTH,
          left: Math.max(
            EDGE_GAP,
            Math.min(anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - EDGE_GAP),
          ),
          ...(below
            ? { top: anchor.bottom + 6 }
            : { bottom: window.innerHeight - anchor.top + 6 }),
        }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        draggable={false}
        // Keeps a press on the trigger from starting a drag on the card behind it.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={toggle}
        className={`flex size-7 shrink-0 items-center justify-center rounded-full transition-colors ${
          open ? 'bg-surface text-ink' : 'text-muted hover:bg-surface hover:text-ink'
        }`}
      >
        <MoreVertical className="size-4" aria-hidden />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={menuRef}
              role="menu"
              aria-label={label}
              initial={{ opacity: 0, scale: 0.96, y: below ? -4 : 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
              transition={transition.tap}
              style={style}
              className="agentix-scroll z-[60] max-h-[60vh] overflow-y-auto card rounded-xl p-1 shadow-2xl"
            >
              {groups.map((group, groupIndex) => (
                <div
                  key={group.label ?? groupIndex}
                  className={groupIndex > 0 ? 'mt-1 border-t border-line pt-1' : ''}
                >
                  {group.label && (
                    <p className="px-2.5 py-1 eyebrow">
                      {group.label}
                    </p>
                  )}
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      aria-disabled={item.disabled}
                      title={item.disabled ? item.hint : undefined}
                      onClick={() => {
                        if (item.disabled) return
                        setAnchor(null)
                        item.onSelect()
                      }}
                      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                        item.disabled
                          ? 'cursor-not-allowed text-muted opacity-60'
                          : item.danger
                            ? 'text-bad hover:bg-bad/10'
                            : item.selected
                              ? 'bg-accent/10 text-accent'
                              : 'text-ink hover:bg-surface'
                      }`}
                    >
                      {item.icon && <span className="mt-0.5 shrink-0">{item.icon}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        {item.hint && (
                          <span className="mt-0.5 block text-xs leading-snug text-muted">
                            {item.hint}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
