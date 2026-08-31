import { AnimatePresence } from 'framer-motion'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { createAIService } from './core/ai'
import { useAuth } from './core/auth/store'
import { queries } from './core/db/queries'
import { features } from './core/features'
import type { PluginContext } from './core/plugin-host/types'
import { activeAIConfig, useSettings } from './core/settings/store'
import { Home } from './screens/Home'
import { CommandPalette } from './shell/CommandPalette'
import { useRouter } from './shell/router'
import { useLevelUp } from './shell/useRank'
import { LevelUpToast } from './ui/components/LevelUpToast'
import { useAppliedTheme } from './ui/useAppliedTheme'

/*
  Home is the only screen a cold start lands on, so it is the only one in the
  entry bundle. The rest are reachable only after a deliberate tap, which is time
  enough to fetch a few kilobytes.
*/
const Organization = lazy(() =>
  import('./screens/Organization').then((m) => ({ default: m.Organization })),
)
const Profile = lazy(() => import('./screens/Profile').then((m) => ({ default: m.Profile })))
const SignIn = lazy(() => import('./screens/SignIn').then((m) => ({ default: m.SignIn })))
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })))
const Theme = lazy(() => import('./screens/Theme').then((m) => ({ default: m.Theme })))

export default function App({ oauthNotice }: { oauthNotice?: string | null }) {
  const { route, navigate, back } = useRouter()
  const [paletteOpen, setPaletteOpen] = useState(false)

  /*
    A level crossed is announced here rather than on the Profile screen, because
    the work that earns it is finished somewhere else — on the board, in a timer.
    The reward has to reach the place the achievement happened.
  */
  const { celebration, dismiss: dismissLevelUp } = useLevelUp()

  // Stamps the chosen scheme and accent onto the document. Called at the root so
  // every screen is themed, including ones that never read the setting themselves.
  useAppliedTheme()

  /*
    Close a timer that was clearly forgotten, once, on open.

    Here rather than in the Task Manager because the damage is done whether or not
    that plugin is ever opened: a session running since yesterday is already
    corrupting Backtest and Workload the moment either is read.
  */
  const autoStopHours = useSettings((s) => s.autoStopHours)
  useEffect(() => {
    void queries.closeForgottenSessions(autoStopHours)
    // Deliberately not re-run when the preference changes: this is a startup
    // sweep, and re-running it mid-session would close a timer someone is
    // deliberately watching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /*
    Put today's routines on the board, once, on open.

    Here rather than in the Habits plugin for the same reason as the sweep above:
    a routine due this morning has to be part of the day's work whether or not
    anyone opens the plugin that owns the rule. It is idempotent — the second call
    of the morning finds every card already there — and it also clears the open
    cards of days that are over, because a routine missed is a miss and not a job
    still owed.
  */
  useEffect(() => {
    void queries.materialiseRoutines()
  }, [])

  // Built once. Plugins get storage and AI only through this object — never a Dexie
  // connection of their own, never the key, never a provider URL.
  //
  // `navigate` is stable, so the context object stays identical across renders and
  // a plugin never re-mounts because the shell re-rendered.
  const ctx = useMemo<PluginContext>(
    () => ({
      db: queries,
      ai: createAIService(activeAIConfig),
      navigate,
    }),
    [navigate],
  )

  /*
    Revalidate the stored session once, on open.

    `restore` only signs out when the server actually rejected the token — an
    unreachable server keeps the session, because being offline is not a reason to
    lock someone out of a database that lives on their own device.
  */
  const session = useAuth((s) => s.session)
  const restore = useAuth((s) => s.restore)
  useEffect(() => {
    // Nothing to restore while accounts are off — there is no server a session
    // could have come from.
    if (!features.accounts) return
    void restore()
  }, [restore])

  /*
    Turn an invitation into a membership, once, when someone signs in.

    An invitation is addressed to an email and carries no account, so something
    has to attach the two the first time that person arrives. Here rather than in
    the Organisation screen, because the whole point of being invited is that the
    app works — the menu an admin granted has to be right on the home screen,
    which is where an invited person actually lands.

    A no-op for everybody else: with no organisation, or nothing addressed to this
    account, `claimMembership` returns undefined and writes nothing.
  */
  const userId = session?.userId ?? null
  const email = session?.email ?? null
  useEffect(() => {
    if (!features.accounts) return
    if (userId === null || email === null) return
    void (async () => {
      const org = await queries.currentOrganization()
      if (org === null) return
      await queries.claimMembership(org.id, email, userId)
    })()
  }, [userId, email])

  // Ctrl/Cmd+K anywhere. Registered on the window rather than a focused element,
  // because the point of a palette is that it works without aiming first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <CommandPalette
        db={queries}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigate}
      />

      <LevelUpToast celebration={celebration} onDismiss={dismissLevelUp} />

      {/*
        One boundary outside the transition rather than one per screen: the exit
        animation of the screen being left plays over the fallback, so a lazy
        screen and an eager one enter identically.
      */}
      <Suspense fallback={null}>
        <AnimatePresence mode="wait">
          {route.name === 'settings' ? (
            <Settings
              key="settings"
              onBack={back}
              onOpenOrganization={() => navigate('organization')}
              onSignIn={() => navigate('signin')}
            />
          ) : route.name === 'profile' ? (
            <Profile key="profile" onBack={back} />
          ) : route.name === 'theme' ? (
            <Theme key="theme" onBack={back} />
          ) : features.accounts && route.name === 'organization' ? (
            <Organization key="organization" onBack={back} onSignIn={() => navigate('signin')} />
          ) : features.accounts && route.name === 'signin' ? (
            <SignIn
              key="signin"
              notice={oauthNotice}
              onSkip={() => navigate('home')}
              onSignedIn={() => navigate('home')}
            />
          ) : (
            <Home
              key="home"
              ctx={ctx}
              onOpenSettings={() => navigate('settings')}
              onOpenProfile={() => navigate('profile')}
              onOpenTheme={() => navigate('theme')}
              openPluginId={route.name === 'plugin' ? route.id : null}
              onOpenPlugin={navigate}
            />
          )}
        </AnimatePresence>
      </Suspense>
    </>
  )
}
