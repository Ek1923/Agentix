import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { providers } from '../ai'
import type { ProviderId } from '../ai/providers/types'

interface SettingsState {
  displayName: string
  avatarId: string
  avatarBackgroundId: string
  themeMode: 'system' | 'light' | 'dark'
  accentId: string
  /** Backtest look-back, in days. Persisted so it survives a reload. */
  backtestWindow: 5 | 10 | 15 | 20 | 30

  /**
   * 1 = Monday, 0 = Sunday. Which day a week starts on is regional, not a
   * detail — a Dutch week that opens on Sunday reads as broken.
   */
  weekStartsOn: 0 | 1
  clockFormat: '24h' | '12h'
  /** New tasks start here, so someone whose work is mostly urgent stops re-picking. */
  defaultPriority: 0 | 1 | 2
  /**
   * Hours after which a still-running timer is closed on next open.
   *
   * A timer left running overnight silently adds fourteen hours to a task and
   * poisons every estimate-accuracy figure that reads it. Zero disables the cap.
   */
  autoStopHours: number
  /** Plugin ids hidden from the menu. Hidden, never uninstalled — data stays. */
  hiddenPluginIds: string[]
  /**
   * Menu order, as plugin ids.
   *
   * Stored rather than derived so a plugin added in a later version appends at
   * the end instead of shuffling an order somebody arranged deliberately.
   */
  pluginOrder: string[]
  /** Sync as soon as the app opens, when an account is signed in. */
  syncOnOpen: boolean

  activeProvider: ProviderId
  /** Chosen model per provider, so switching providers restores the last pick. */
  modelByProvider: Record<ProviderId, string>

  setDisplayName: (name: string) => void
  setAvatar: (id: string) => void
  setAvatarBackground: (id: string) => void
  setThemeMode: (mode: 'system' | 'light' | 'dark') => void
  setAccent: (id: string) => void
  setBacktestWindow: (days: 5 | 10 | 15 | 20 | 30) => void
  setWeekStartsOn: (day: 0 | 1) => void
  setClockFormat: (format: '24h' | '12h') => void
  setDefaultPriority: (priority: 0 | 1 | 2) => void
  setAutoStopHours: (hours: number) => void
  togglePlugin: (id: string) => void
  movePlugin: (id: string, direction: -1 | 1, allIds: string[]) => void
  setPluginOrder: (ids: string[]) => void
  setSyncOnOpen: (on: boolean) => void
  setActiveProvider: (id: ProviderId) => void
  setModel: (id: ProviderId, model: string) => void
}

const defaultModel = (id: ProviderId): string => providers[id].models[0] ?? ''

/**
 * Applies a saved order to the plugins that exist right now.
 *
 * Saved ids that no longer exist are dropped, and plugins the saved order has
 * never seen are appended in registry order. A stored list is a preference, not
 * a source of truth about what is installed.
 */
export function orderPlugins(allIds: string[], savedOrder: string[]): string[] {
  const known = new Set(allIds)
  const ordered = savedOrder.filter((id) => known.has(id))
  const seen = new Set(ordered)
  return [...ordered, ...allIds.filter((id) => !seen.has(id))]
}

/**
 * Non-secret preferences only. API keys are never in this store — it persists to
 * localStorage, and localStorage is the wrong place for a credential.
 */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      displayName: '',
      // Plain ids, not imports from ui/avatars.ts — core must stay free of React so
      // it can be translated to Swift as-is. The catalog resolves unknown ids to a
      // default, and a test asserts these two still name real entries.
      avatarId: 'initials',
      avatarBackgroundId: 'slate',
      themeMode: 'system',
      accentId: 'blue',
      backtestWindow: 10,
      weekStartsOn: 1,
      clockFormat: '24h',
      defaultPriority: 0,
      autoStopHours: 8,
      hiddenPluginIds: [],
      pluginOrder: [],
      syncOnOpen: true,
      activeProvider: 'anthropic',
      modelByProvider: {
        anthropic: defaultModel('anthropic'),
        openai: defaultModel('openai'),
      },

      setDisplayName: (displayName) => set({ displayName }),
      setAvatar: (avatarId) => set({ avatarId }),
      setAvatarBackground: (avatarBackgroundId) => set({ avatarBackgroundId }),
      setThemeMode: (themeMode) => set({ themeMode }),
      setAccent: (accentId) => set({ accentId }),
      setBacktestWindow: (backtestWindow) => set({ backtestWindow }),
      setWeekStartsOn: (weekStartsOn) => set({ weekStartsOn }),
      setClockFormat: (clockFormat) => set({ clockFormat }),
      setDefaultPriority: (defaultPriority) => set({ defaultPriority }),
      setAutoStopHours: (autoStopHours) => set({ autoStopHours }),
      togglePlugin: (id) =>
        set((state) => ({
          hiddenPluginIds: state.hiddenPluginIds.includes(id)
            ? state.hiddenPluginIds.filter((existing) => existing !== id)
            : [...state.hiddenPluginIds, id],
        })),
      /**
       * Moves one plugin a step, resolving the stored order against the plugins
       * that actually exist first — so an order saved before a plugin was added,
       * or after one was removed, still moves the right thing.
       */
      movePlugin: (id, direction, allIds) =>
        set((state) => {
          const ordered = orderPlugins(allIds, state.pluginOrder)
          const from = ordered.indexOf(id)
          const to = from + direction
          if (from === -1 || to < 0 || to >= ordered.length) return state

          const next = [...ordered]
          const [moved] = next.splice(from, 1)
          next.splice(to, 0, moved!)
          return { pluginOrder: next }
        }),
      setPluginOrder: (pluginOrder) => set({ pluginOrder }),
      setSyncOnOpen: (syncOnOpen) => set({ syncOnOpen }),
      setActiveProvider: (activeProvider) => set({ activeProvider }),
      setModel: (id, model) =>
        set((s) => ({ modelByProvider: { ...s.modelByProvider, [id]: model } })),
    }),
    { name: 'agentix-settings' },
  ),
)

/** Reads current settings outside React — used to build the plugin AI service. */
export function activeAIConfig(): { providerId: ProviderId; model: string } {
  const { activeProvider, modelByProvider } = useSettings.getState()
  return {
    providerId: activeProvider,
    model: modelByProvider[activeProvider] || defaultModel(activeProvider),
  }
}
