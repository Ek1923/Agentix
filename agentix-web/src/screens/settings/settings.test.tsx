// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import { registry } from '../../core/plugin-host/registry'
import { orderPlugins, useSettings } from '../../core/settings/store'
import { readStoredConfig, saveStoredConfig } from '../../core/sync/supabase'
import { PluginBar } from '../../shell/PluginBar'
import { Connection } from './Connection'
import { PluginSettings } from './PluginSettings'
import { Preferences } from './Preferences'

const ALL_IDS = registry.map((p) => p.manifest.id)

/*
  The connection card polls the project's health, so rendering it would otherwise
  put a real request to a real host into the test run. Stubbed rather than
  allowed: a suite that reaches the network is slow, flaky offline, and quietly
  contradicts the guarantee `privacy.test.ts` is there to protect.
*/
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ name: 'GoTrue' }), { status: 200 })),
  )
})

beforeEach(async () => {
  await db.open()
  localStorage.clear()
  useSettings.setState({
    hiddenPluginIds: [],
    pluginOrder: [],
    weekStartsOn: 1,
    clockFormat: '24h',
    defaultPriority: 0,
    autoStopHours: 8,
    syncOnOpen: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
  vi.unstubAllEnvs()
})

describe('orderPlugins', () => {
  it('keeps a saved order and appends anything it has never seen', () => {
    // A plugin added in a later version must land at the end, not shuffle an
    // order somebody arranged deliberately.
    expect(orderPlugins(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a', 'b'])
  })

  it('drops saved ids that no longer exist', () => {
    expect(orderPlugins(['a', 'b'], ['removed', 'b', 'a'])).toEqual(['b', 'a'])
  })

  it('falls back to registry order when nothing is saved', () => {
    expect(orderPlugins(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c'])
  })
})

describe('plugin settings', () => {
  it('lists every plugin with a reorder handle', () => {
    render(<PluginSettings />)

    for (const plugin of registry) {
      expect(
        screen.getByRole('button', { name: `Reorder ${plugin.manifest.name}` }),
      ).toBeInTheDocument()
    }
  })

  it('moves a plugin down with the arrows, and the menu follows', async () => {
    const user = userEvent.setup()
    const [first, second] = ALL_IDS

    render(<PluginSettings />)
    await user.click(
      screen.getByRole('button', { name: `Move ${registry[0]!.manifest.name} down` }),
    )

    expect(useSettings.getState().pluginOrder.slice(0, 2)).toEqual([second, first])

    cleanup()
    render(<PluginBar onOpen={() => {}} onOpenTheme={() => {}} aiConfigured />)
    const rows = screen.getAllByRole('button')
    // Theme is shell chrome and always leads; the reordered plugin follows it.
    expect(rows[1]).toHaveTextContent(registry[1]!.manifest.name)
  })

  it('offers no move past either end', () => {
    render(<PluginSettings />)

    expect(
      screen.getByRole('button', { name: `Move ${registry[0]!.manifest.name} up` }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', {
        name: `Move ${registry[registry.length - 1]!.manifest.name} down`,
      }),
    ).toBeDisabled()
  })

  it('hides a plugin from the menu without touching its data', async () => {
    const user = userEvent.setup()
    const target = registry[0]!

    render(<PluginSettings />)
    await user.click(screen.getByRole('switch', { name: target.manifest.name }))

    expect(useSettings.getState().hiddenPluginIds).toEqual([target.manifest.id])

    cleanup()
    render(<PluginBar onOpen={() => {}} onOpenTheme={() => {}} aiConfigured />)
    expect(
      screen.queryByRole('button', { name: new RegExp(target.manifest.name) }),
    ).not.toBeInTheDocument()
  })

  it('counts what is shown, not what exists', async () => {
    const user = userEvent.setup()
    render(<PluginSettings />)

    await user.click(screen.getByRole('switch', { name: registry[0]!.manifest.name }))
    expect(
      screen.getByText(new RegExp(`${registry.length - 1} of ${registry.length} shown`)),
    ).toBeInTheDocument()
  })
})

describe('preferences', () => {
  it('changes the day a week opens on', async () => {
    const user = userEvent.setup()
    render(<Preferences />)

    await user.click(screen.getByRole('radio', { name: 'Sunday' }))
    expect(useSettings.getState().weekStartsOn).toBe(0)
  })

  it('switches the clock between 24h and 12h', async () => {
    const user = userEvent.setup()
    render(<Preferences />)

    await user.click(screen.getByRole('radio', { name: '12h' }))
    expect(useSettings.getState().clockFormat).toBe('12h')
  })

  it('sets where a new task starts', async () => {
    const user = userEvent.setup()
    render(<Preferences />)

    await user.click(screen.getByRole('radio', { name: 'Urgent' }))
    expect(useSettings.getState().defaultPriority).toBe(2)
  })

  it('can turn the forgotten-timer cap off entirely', async () => {
    const user = userEvent.setup()
    render(<Preferences />)

    await user.click(screen.getByRole('radio', { name: /Never stop a running timer/ }))
    expect(useSettings.getState().autoStopHours).toBe(0)
  })

  it('toggles sync on open', async () => {
    const user = userEvent.setup()
    render(<Preferences />)

    await user.click(screen.getByRole('switch', { name: /Sync when the app opens/ }))
    expect(useSettings.getState().syncOnOpen).toBe(false)
  })
})

describe('the sync connection', () => {
  beforeEach(() => {
    /*
      The health light polls the live project as soon as a row renders. Stubbed so
      the suite never reaches the network — an unstubbed fetch here would make
      these tests depend on a host that does not exist.
    */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: 'GoTrue' }), { status: 200 })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function openAddForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Add a project/ }))
  }

  it('says plainly when there is nothing to sync to', () => {
    render(<Connection />)
    expect(screen.getByText(/No project yet/)).toBeInTheDocument()
  })

  it('refuses to save an incomplete pair', async () => {
    const user = userEvent.setup()
    render(<Connection />)
    await openAddForm(user)

    await user.type(screen.getByLabelText('Project URL'), 'https://example.supabase.co')
    // A URL without a key is not a connection.
    expect(screen.getByRole('button', { name: /Save and use/ })).toBeDisabled()
  })

  it('saves a project on this device, no rebuild needed', async () => {
    const user = userEvent.setup()
    render(<Connection />)
    await openAddForm(user)

    await user.type(screen.getByLabelText('Project URL'), 'https://example.supabase.co')
    await user.type(screen.getByLabelText('Anon key'), 'a'.repeat(40))
    await user.click(screen.getByRole('button', { name: /Save and use/ }))

    expect(readStoredConfig()).toEqual({
      url: 'https://example.supabase.co',
      anonKey: 'a'.repeat(40),
    })
    expect(await screen.findByDisplayValue('example')).toBeInTheDocument()
  })

  it('assumes https on a bare host, because that is what people paste', async () => {
    const user = userEvent.setup()
    render(<Connection />)
    await openAddForm(user)

    const url = screen.getByLabelText('Project URL')
    await user.type(url, 'example.supabase.co')
    await user.tab()

    expect((url as HTMLInputElement).value).toBe('https://example.supabase.co')
  })

  it('keeps more than one project and switches between them', async () => {
    const user = userEvent.setup()
    saveStoredConfig({ url: 'https://one.supabase.co', anonKey: 'a'.repeat(40) })
    saveStoredConfig({ url: 'https://two.supabase.co', anonKey: 'b'.repeat(40) })

    render(<Connection />)
    // The most recent save is the live one, so the other offers to take over.
    expect(readStoredConfig()?.url).toBe('https://two.supabase.co')

    await user.click(screen.getByRole('button', { name: 'Use this' }))
    expect(readStoredConfig()?.url).toBe('https://one.supabase.co')
  })

  it('renames a project without touching the connection', async () => {
    const user = userEvent.setup()
    saveStoredConfig({ url: 'https://one.supabase.co', anonKey: 'a'.repeat(40) })

    render(<Connection />)
    const name = screen.getByLabelText('Name for https://one.supabase.co')
    await user.clear(name)
    await user.type(name, 'Production')
    await user.tab()

    expect(readStoredConfig()?.anonKey).toBe('a'.repeat(40))
    expect(await screen.findByDisplayValue('Production')).toBeInTheDocument()
  })

  it('asks before forgetting one, then forgets it', async () => {
    const user = userEvent.setup()
    saveStoredConfig({ url: 'https://one.supabase.co', anonKey: 'a'.repeat(40) })

    render(<Connection />)
    await user.click(screen.getByRole('button', { name: /Forget one/ }))
    // Nothing has gone yet — the first press only arms it.
    expect(readStoredConfig()).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Forget' }))
    expect(readStoredConfig()).toBeNull()
  })

  it('falls back to another project rather than disconnecting', async () => {
    const user = userEvent.setup()
    saveStoredConfig({ url: 'https://one.supabase.co', anonKey: 'a'.repeat(40) })
    saveStoredConfig({ url: 'https://two.supabase.co', anonKey: 'b'.repeat(40) })

    render(<Connection />)
    await user.click(screen.getByRole('button', { name: /Forget two/ }))
    await user.click(screen.getByRole('button', { name: 'Forget' }))

    // Losing the live project hands the device to its next best option.
    expect(readStoredConfig()?.url).toBe('https://one.supabase.co')
  })

  it('reports the live project as reachable once it answers', async () => {
    saveStoredConfig({ url: 'https://one.supabase.co', anonKey: 'a'.repeat(40) })

    render(<Connection />)
    expect(await screen.findByText(/Reachable/)).toBeInTheDocument()
  })

  it('tells a refused key apart from a dead project', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    saveStoredConfig({ url: 'https://one.supabase.co', anonKey: 'a'.repeat(40) })

    render(<Connection />)
    expect(await screen.findByText(/refused the key/i)).toBeInTheDocument()
  })
})

describe('the forgotten-timer sweep', () => {
  beforeEach(async () => {
    await Promise.all([db.tasks.clear(), db.sessions.clear(), db.syncOutbox.clear()])
  })

  it('closes a timer left running past the cap', async () => {
    const task = await queries.createTask({ title: 'Left running', plannedFor: queries.todayLocal() })
    const session = await queries.startSession(task.id)
    await db.sessions.update(session.id, {
      startedAt: new Date(Date.now() - 20 * 3_600_000).toISOString(),
    })

    const closed = await queries.closeForgottenSessions(8)

    expect(closed).toBe(1)
    const saved = await db.sessions.get(session.id)
    expect(saved?.endedAt).not.toBeNull()

    // Closed at the cap, not at now: the hours after the cap are not evidence.
    const minutes =
      (Date.parse(saved!.endedAt!) - Date.parse(saved!.startedAt)) / 60_000
    expect(Math.round(minutes)).toBe(8 * 60)
  })

  it('leaves a timer inside the cap alone', async () => {
    const task = await queries.createTask({ title: 'Still going', plannedFor: queries.todayLocal() })
    await queries.startSession(task.id)

    expect(await queries.closeForgottenSessions(8)).toBe(0)
    expect(await queries.getRunningSession()).toBeDefined()
  })

  it('does nothing at all when the cap is off', async () => {
    const task = await queries.createTask({ title: 'Forever', plannedFor: queries.todayLocal() })
    const session = await queries.startSession(task.id)
    await db.sessions.update(session.id, {
      startedAt: new Date(Date.now() - 200 * 3_600_000).toISOString(),
    })

    expect(await queries.closeForgottenSessions(0)).toBe(0)
    expect(await queries.getRunningSession()).toBeDefined()
  })

  it('queues the closed session for the next sync', async () => {
    const task = await queries.createTask({ title: 'Sync me', plannedFor: queries.todayLocal() })
    const session = await queries.startSession(task.id)
    await db.sessions.update(session.id, {
      startedAt: new Date(Date.now() - 20 * 3_600_000).toISOString(),
    })
    await queries.clearOutbox((await queries.listOutbox()).map((e) => e.id))

    await queries.closeForgottenSessions(8)

    const queued = await queries.listOutbox()
    expect(queued.some((entry) => entry.rowId === session.id)).toBe(true)
  })
})

describe('erasing everything', () => {
  it('removes every row, permanently', async () => {
    await queries.createTask({ title: 'Gone', plannedFor: queries.todayLocal() })
    await queries.createNote({ content: 'Also gone' })
    await queries.createHabit('Gone too', [], null, 'ocean')

    await queries.eraseEverything()

    // A hard delete, unlike every other delete in the app.
    expect(await db.tasks.count()).toBe(0)
    expect(await db.notes.count()).toBe(0)
    expect(await db.habits.count()).toBe(0)
    expect(await queries.listTrash()).toEqual([])
    expect(await queries.listOutbox()).toEqual([])
  })
})

describe('the menu', () => {
  it('shows hidden plugins again once they are unhidden', async () => {
    const user = userEvent.setup()
    const target = registry[0]!
    useSettings.setState({ hiddenPluginIds: [target.manifest.id] })

    render(<PluginSettings />)
    await user.click(screen.getByRole('switch', { name: target.manifest.name }))

    cleanup()
    render(<PluginBar onOpen={() => {}} onOpenTheme={() => {}} aiConfigured />)
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: new RegExp(target.manifest.name) }),
      ).toBeInTheDocument()
    })
  })

  it('says Theme is still there when every plugin is hidden', () => {
    useSettings.setState({ hiddenPluginIds: ALL_IDS })

    render(<PluginBar onOpen={() => {}} onOpenTheme={() => {}} aiConfigured />)
    const menu = screen.getByText('No plugins')

    expect(menu).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Theme/ })).toBeInTheDocument()
  })
})

describe('week start reaches the agenda', () => {
  it('changes which day the strip opens on', async () => {
    const { weekOf } = await import('../../core/dates')

    // 2026-08-27 is a Thursday.
    expect(weekOf('2026-08-27', 1)[0]).toBe('2026-08-24')
    expect(weekOf('2026-08-27', 0)[0]).toBe('2026-08-23')
  })
})

describe('clock format reaches Backtest', () => {
  it('formats midnight and noon correctly in both', async () => {
    const { formatClockParts } = await import('../../plugins/backtest/logic/metrics')

    expect(formatClockParts(0, 30, '24h')).toBe('00:30')
    expect(formatClockParts(13, 5, '24h')).toBe('13:05')

    // The two a naive hours % 12 gets wrong: both come out as 0.
    expect(formatClockParts(0, 30, '12h')).toBe('12:30 AM')
    expect(formatClockParts(12, 5, '12h')).toBe('12:05 PM')
    expect(formatClockParts(13, 5, '12h')).toBe('1:05 PM')
  })
})

describe('plugin settings within a card', () => {
  it('keeps the switch and the drag handle as separate controls', () => {
    // Dragging the row itself would turn every attempted toggle into a half-drag.
    render(<PluginSettings />)
    const name = registry[0]!.manifest.name

    const row = screen.getByRole('switch', { name }).closest('li')
    expect(row).not.toBeNull()
    expect(within(row!).getByRole('button', { name: `Reorder ${name}` })).toBeInTheDocument()
  })
})
