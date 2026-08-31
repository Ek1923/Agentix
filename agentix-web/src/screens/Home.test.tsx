// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAIService } from '../core/ai'
import { deleteKey } from '../core/ai/secure-store'
import { queries } from '../core/db/queries'
import { registry } from '../core/plugin-host/registry'
import type { PluginContext } from '../core/plugin-host/types'
import { activeAIConfig, useSettings } from '../core/settings/store'
import { Home } from './Home'

const ctx: PluginContext = {
  db: queries,
  ai: createAIService(activeAIConfig),
  navigate: () => {},
}

function renderHome(overrides: Partial<Parameters<typeof Home>[0]> = {}) {
  return render(
    <Home
      ctx={ctx}
      onOpenSettings={overrides.onOpenSettings ?? (() => {})}
      onOpenProfile={overrides.onOpenProfile ?? (() => {})}
      onOpenTheme={overrides.onOpenTheme ?? (() => {})}
      openPluginId={overrides.openPluginId ?? null}
      onOpenPlugin={overrides.onOpenPlugin ?? (() => {})}
    />,
  )
}

beforeEach(async () => {
  await deleteKey('anthropic')
  await deleteKey('openai')
  useSettings.setState({ activeProvider: 'anthropic', displayName: '' })
  registry.length = 0
})

afterEach(cleanup)

describe('Home', () => {
  it('shows the profile bar, the settings gear, and the real empty state', () => {
    renderHome()

    expect(screen.getByText('Your agenda')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('No plugins installed yet.')).toBeInTheDocument()
  })

  it('shows the display name once one is set', () => {
    useSettings.setState({ displayName: 'Ege Baykal' })
    renderHome()

    expect(screen.getByText('Ege Baykal')).toBeInTheDocument()
    expect(screen.getByText('EB')).toBeInTheDocument()
  })

  it('opens the profile from the profile bar', async () => {
    const onOpenProfile = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()

    renderHome({ onOpenProfile })
    await user.click(screen.getByRole('button', { name: 'Profile' }))

    expect(onOpenProfile).toHaveBeenCalledOnce()
  })

  it('opens settings from the gear', async () => {
    const onOpenSettings = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()

    renderHome({ onOpenSettings })
    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('renders tiles from the registry without special-casing any plugin', () => {
    registry.push({
      manifest: {
        id: 'task-manager',
        name: 'Task Manager',
        icon: 'ListTodo',
        version: '1.0.0',
        requiresAI: false,
      },
      Component: () => <div>task manager body</div>,
    })

    renderHome()

    expect(screen.getByText('Task Manager')).toBeInTheDocument()
    expect(screen.queryByText('No plugins installed yet.')).not.toBeInTheDocument()
  })

  it('hints at a missing key on an AI plugin rather than erroring', async () => {
    registry.push({
      manifest: {
        id: 'note-taker',
        name: 'Note Taker',
        icon: 'NotebookPen',
        version: '1.0.0',
        requiresAI: true,
      },
      Component: () => <div>notes</div>,
    })

    renderHome()

    expect(await screen.findByText('Needs an API key')).toBeInTheDocument()
  })

  it('renders an opened plugin through the shared context', () => {
    registry.push({
      manifest: {
        id: 'task-manager',
        name: 'Task Manager',
        icon: 'ListTodo',
        version: '1.0.0',
        requiresAI: false,
      },
      Component: ({ ctx: pluginCtx }) => (
        <div>{typeof pluginCtx.db.createTask === 'function' ? 'has db' : 'no db'}</div>
      ),
    })

    renderHome({ openPluginId: 'task-manager' })

    expect(screen.getByText('has db')).toBeInTheDocument()
  })
})
