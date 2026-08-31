import { Reorder, useDragControls } from 'framer-motion'
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical } from 'lucide-react'
import type { AgentixPlugin } from '../../core/plugin-host/types'
import { registry } from '../../core/plugin-host/registry'
import { orderPlugins, useSettings } from '../../core/settings/store'
import { Card } from '../../ui/components/Card'
import { feedback } from '../../ui/feedback'
import { ManifestIcon } from '../../ui/icons'

/**
 * Which plugins appear in the menu, and in what order.
 *
 * Nine entries is more than most people use daily, and a menu whose last items
 * are never opened has stopped being scannable. Hiding is not uninstalling: the
 * data stays, the plugin still opens if something links to it, and unhiding
 * restores it exactly.
 */
export function PluginSettings() {
  const hidden = useSettings((s) => s.hiddenPluginIds)
  const savedOrder = useSettings((s) => s.pluginOrder)
  const toggle = useSettings((s) => s.togglePlugin)
  const move = useSettings((s) => s.movePlugin)
  const setOrder = useSettings((s) => s.setPluginOrder)

  const allIds = registry.map((plugin) => plugin.manifest.id)
  const byId = new Map(registry.map((plugin) => [plugin.manifest.id, plugin]))
  const orderedIds = orderPlugins(allIds, savedOrder)

  const visibleCount = registry.length - hidden.length

  return (
    <Card
      title="Plugins"
      description={`${visibleCount} of ${registry.length} shown in the menu, in this order. Drag by the handle, or use the arrows.`}
    >
      <Reorder.Group
        axis="y"
        values={orderedIds}
        onReorder={setOrder}
        className="flex flex-col gap-1.5"
      >
        {orderedIds.map((id, index) => (
          <PluginRow
            key={id}
            plugin={byId.get(id)!}
            index={index}
            total={orderedIds.length}
            hidden={hidden.includes(id)}
            onToggle={() => {
              feedback('selection')
              toggle(id)
            }}
            onMove={(direction) => {
              feedback('selection')
              move(id, direction, allIds)
            }}
          />
        ))}
      </Reorder.Group>

      {visibleCount === 0 && (
        <p className="mt-3 text-xs text-muted">
          Every plugin is hidden. The menu will show only Theme until you bring one
          back.
        </p>
      )}
    </Card>
  )
}

interface PluginRowProps {
  plugin: AgentixPlugin
  index: number
  total: number
  hidden: boolean
  onToggle: () => void
  onMove: (direction: -1 | 1) => void
}

function PluginRow({ plugin, index, total, hidden, onToggle, onMove }: PluginRowProps) {
  const controls = useDragControls()

  return (
    <Reorder.Item
      value={plugin.manifest.id}
      /*
        Dragging starts from the handle only. The row itself is a switch, so
        making the whole thing draggable would turn every attempted toggle into
        a half-drag.
      */
      dragListener={false}
      dragControls={controls}
      onDragStart={() => feedback('light')}
      onDragEnd={() => feedback('medium')}
      whileDrag={{
        scale: 1.02,
        cursor: 'grabbing',
        zIndex: 10,
        boxShadow: 'var(--shadow-lift)',
      }}
      transition={{ type: 'spring', stiffness: 520, damping: 38 }}
      className="flex items-center gap-1.5"
    >
      <button
        type="button"
        aria-label={`Reorder ${plugin.manifest.name}`}
        onPointerDown={(event) => controls.start(event)}
        className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted transition-colors hover:text-ink active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>

      {/*
        The arrows stay. Dragging is a mouse affordance; without these the order
        would be unreachable from a keyboard.
      */}
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          aria-label={`Move ${plugin.manifest.name} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className="flex size-5 items-center justify-center rounded text-muted transition-colors hover:text-ink disabled:opacity-25"
        >
          <ArrowUp className="size-3" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Move ${plugin.manifest.name} down`}
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          className="flex size-5 items-center justify-center rounded text-muted transition-colors hover:text-ink disabled:opacity-25"
        >
          <ArrowDown className="size-3" aria-hidden />
        </button>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={!hidden}
        aria-label={plugin.manifest.name}
        onClick={onToggle}
        className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
          hidden ? 'border-line bg-transparent' : 'border-line bg-elevated hover:border-accent/60'
        }`}
      >
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
            hidden ? 'bg-transparent text-muted' : 'bg-surface text-accent'
          }`}
        >
          <ManifestIcon name={plugin.manifest.icon} className="size-4" />
        </span>

        <span
          className={`min-w-0 flex-1 truncate text-sm font-medium ${
            hidden ? 'text-muted' : 'text-ink'
          }`}
        >
          {plugin.manifest.name}
        </span>

        {plugin.manifest.requiresAI && <span className="eyebrow shrink-0">needs a key</span>}

        {hidden ? (
          <EyeOff className="size-4 shrink-0 text-muted" aria-hidden />
        ) : (
          <Eye className="size-4 shrink-0 text-accent" aria-hidden />
        )}
      </button>
    </Reorder.Item>
  )
}
