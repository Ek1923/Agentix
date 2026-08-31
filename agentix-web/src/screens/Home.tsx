import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { Suspense } from 'react'
import { findPlugin } from '../core/plugin-host/registry'
import type { PluginContext } from '../core/plugin-host/types'
import { useSettings } from '../core/settings/store'
import { PluginBar } from '../shell/PluginBar'
import { ProfileBar } from '../shell/ProfileBar'
import { SettingsButton } from '../shell/SettingsButton'
import { TodayHero } from '../shell/TodayHero'
import { Button } from '../ui/components/Button'
import { transition } from '../ui/tokens'

interface HomeProps {
  ctx: PluginContext
  onOpenSettings: () => void
  onOpenProfile: () => void
  onOpenTheme: () => void
  openPluginId: string | null
  onOpenPlugin: (id: string) => void
}

export function Home({
  ctx,
  onOpenSettings,
  onOpenProfile,
  onOpenTheme,
  openPluginId,
  onOpenPlugin,
}: HomeProps) {
  const activeProvider = useSettings((s) => s.activeProvider)

  // useLiveQuery re-runs when the secure store changes, so saving a key updates the
  // plugin hints immediately — no effect, no manual refresh.
  const aiConfigured = useLiveQuery(
    () => ctx.ai.isConfigured(),
    [activeProvider],
    false,
  )

  const open = openPluginId ? findPlugin(openPluginId) : undefined

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={transition.screen}
      className="mx-auto w-full max-w-4xl px-6 py-8"
    >
      <header className="flex items-center justify-between">
        <ProfileBar onOpenProfile={onOpenProfile} />
        <SettingsButton onClick={onOpenSettings} />
      </header>

      {/*
        The hero is only for the home screen itself. Inside a plugin the greeting
        would be a second header competing with the plugin's own.
      */}
      {!open && (
        <div className="mt-10">
          <TodayHero db={ctx.db} />
        </div>
      )}

      <div className="mt-10">
        {open ? (
          <>
            {/*
              The shell owns the back affordance so no plugin has to draw its own,
              and it reads the name off the manifest rather than knowing which
              plugin is open.
            */}
            <div className="mb-6 flex items-center gap-3">
              <Button variant="ghost" onClick={() => window.history.back()}>
                <ArrowLeft className="size-4" aria-hidden />
                Back
              </Button>
              <h1 className="display text-lg text-ink">{open.manifest.name}</h1>
            </div>
            <Suspense fallback={<PluginSkeleton />}>
              <open.Component ctx={ctx} />
            </Suspense>
          </>
        ) : (
          <PluginBar
            onOpen={onOpenPlugin}
            onOpenTheme={onOpenTheme}
            aiConfigured={aiConfigured}
          />
        )}
      </div>
    </motion.main>
  )
}

/**
 * What a plugin's chunk loading looks like.
 *
 * Shaped like the screens it stands in for — a header line and a couple of cards
 * — rather than a spinner, so the layout does not jump when the real thing
 * arrives. On a warm cache it is never seen; on a cold one it is a beat.
 */
function PluginSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <div className="h-5 w-40 animate-pulse rounded-lg bg-line" />
      <div className="card h-28 animate-pulse rounded-2xl" />
      <div className="card h-28 animate-pulse rounded-2xl" />
    </div>
  )
}
