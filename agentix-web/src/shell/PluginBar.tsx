import { motion } from 'framer-motion'
import { Blocks, ChevronRight, Palette } from 'lucide-react'
import { effectivePluginIds } from '../core/org/members'
import { registry } from '../core/plugin-host/registry'
import { orderPlugins, useSettings } from '../core/settings/store'
import { EmptyState } from '../ui/components/EmptyState'
import { ManifestIcon } from '../ui/icons'
import { transition } from '../ui/tokens'
import { useOrg } from './useOrg'

interface PluginBarProps {
  onOpen: (pluginId: string) => void
  onOpenTheme: () => void
  /** False when the active provider has no key — AI plugins get a hint, not an error. */
  aiConfigured: boolean
}

interface BarRowProps {
  name: string
  hint?: string
  accent?: boolean
  icon: React.ReactNode
  onClick: () => void
}

/**
 * One row of the menu.
 *
 * Deliberately a single line. The subtitle used to carry a version number, which
 * cost every row a second line of height to say almost nothing — and with ten
 * entries that was the difference between seeing the whole menu and scrolling it.
 */
function BarRow({ name, hint, accent, icon, onClick }: BarRowProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ x: 3 }}
      whileTap={{ scale: 0.99 }}
      transition={transition.tap}
      className="group flex w-full items-center gap-3 card rounded-xl px-3 py-2 text-left transition-colors hover:border-accent/60"
    >
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
          accent ? 'bg-accent/15 text-accent' : 'bg-surface text-accent'
        }`}
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name}</span>

      {hint && (
        <span className="shrink-0 rounded-full border border-warn/40 px-2 py-0.5 text-[11px] text-warn">
          {hint}
        </span>
      )}

      <ChevronRight
        className="size-4 shrink-0 text-muted transition-colors group-hover:text-accent"
        aria-hidden
      />
    </motion.button>
  )
}

/**
 * The plugin menu: a stack of thin bars.
 *
 * No height cap and no inner scroller — every entry is visible at once, and the
 * page scrolls if the screen is short. A menu you have to scroll to discover is
 * a menu whose last entries never get used.
 *
 * Theme sits at the top as shell chrome; the shell still reads nothing but the
 * manifest from each plugin below it.
 */
export function PluginBar({ onOpen, onOpenTheme, aiConfigured }: PluginBarProps) {
  // Hidden, not uninstalled: a hidden plugin still opens if something links to
  // it, and its data is untouched.
  const hidden = useSettings((s) => s.hiddenPluginIds)
  const savedOrder = useSettings((s) => s.pluginOrder)

  /*
    Two different filters, deliberately not merged.

    `hidden` is this person's own choice about their own menu. `allowed` is what
    an admin has granted, and it is not theirs to change — so an org that has
    narrowed someone's access wins over a preference that would widen it.

    Without an organisation `me` is null and this is the identity function, which
    is why the personal install is untouched by any of it.
  */
  const { me } = useOrg()
  const installed = registry.map((plugin) => plugin.manifest.id)
  const allowed = me === null ? installed : effectivePluginIds(me, installed)

  const byId = new Map(registry.map((plugin) => [plugin.manifest.id, plugin]))
  const visible = orderPlugins(allowed, savedOrder)
    .filter((id) => !hidden.includes(id))
    .map((id) => byId.get(id)!)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">Menu</h2>
        <span className="text-xs text-muted">
          {visible.length === 0
            ? 'No plugins'
            : `${visible.length} plugin${visible.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <BarRow
          name="Theme"
          accent
          icon={<Palette className="size-4" aria-hidden />}
          onClick={onOpenTheme}
        />

        {visible.length === 0 ? (
          <EmptyState
            icon={<Blocks className="size-8" aria-hidden />}
            title="No plugins installed yet."
            body="Agentix is a shell. Plugins bring the features — the first one arrives with Task Manager."
          />
        ) : (
          visible.map((plugin) => (
            <BarRow
              key={plugin.manifest.id}
              name={plugin.manifest.name}
              hint={
                plugin.manifest.requiresAI && !aiConfigured ? 'Needs an API key' : undefined
              }
              icon={<ManifestIcon name={plugin.manifest.icon} className="size-4" />}
              onClick={() => onOpen(plugin.manifest.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
