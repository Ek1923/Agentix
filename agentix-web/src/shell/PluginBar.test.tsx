// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registry } from '../core/plugin-host/registry'
import type { AgentixPlugin } from '../core/plugin-host/types'
import { PluginBar } from './PluginBar'

function fakePlugin(id: string, requiresAI = false): AgentixPlugin {
  return {
    manifest: { id, name: id, icon: 'ListTodo', version: '1.0.0', requiresAI },
    Component: () => <div>{id}</div>,
  }
}

function renderBar(aiConfigured = true, onOpen = vi.fn(), onOpenTheme = vi.fn()) {
  render(
    <PluginBar onOpen={onOpen} onOpenTheme={onOpenTheme} aiConfigured={aiConfigured} />,
  )
  return { onOpen, onOpenTheme }
}

beforeEach(() => {
  registry.length = 0
})

afterEach(cleanup)

describe('PluginBar', () => {
  it('offers Theme above the plugins', () => {
    registry.push(fakePlugin('task-manager'))
    renderBar()

    const rows = screen.getAllByRole('button')
    expect(rows[0]).toHaveTextContent('Theme')
    expect(rows[1]).toHaveTextContent('task-manager')
  })

  it('opens the theme screen', async () => {
    const user = userEvent.setup()
    const { onOpenTheme } = renderBar()

    await user.click(screen.getByRole('button', { name: /Theme/ }))
    expect(onOpenTheme).toHaveBeenCalledOnce()
  })

  it('still offers Theme when no plugins are installed', () => {
    renderBar()

    expect(screen.getByRole('button', { name: /Theme/ })).toBeInTheDocument()
    expect(screen.getByText('No plugins installed yet.')).toBeInTheDocument()
    expect(screen.getByText('No plugins')).toBeInTheDocument()
  })

  it('opens a plugin by its manifest id', async () => {
    const user = userEvent.setup()
    registry.push(fakePlugin('task-manager'))
    const { onOpen } = renderBar()

    await user.click(screen.getByRole('button', { name: /task-manager/ }))
    expect(onOpen).toHaveBeenCalledWith('task-manager')
  })

  it('counts installed plugins', () => {
    registry.push(fakePlugin('one'), fakePlugin('two'))
    renderBar()
    expect(screen.getByText('2 plugins')).toBeInTheDocument()
  })

  it('uses the singular for one plugin', () => {
    registry.push(fakePlugin('one'))
    renderBar()
    expect(screen.getByText('1 plugin')).toBeInTheDocument()
  })

  it('hints at a missing key on an AI plugin rather than erroring', () => {
    registry.push(fakePlugin('note-taker', true))
    renderBar(false)

    expect(screen.getByText('Needs an API key')).toBeInTheDocument()
  })

  it('drops the hint once a key is configured', () => {
    registry.push(fakePlugin('note-taker', true))
    renderBar(true)

    expect(screen.queryByText('Needs an API key')).not.toBeInTheDocument()
  })

  it('shows every entry at once, with no inner scroller to hide the last ones', () => {
    registry.push(...Array.from({ length: 12 }, (_, i) => fakePlugin(`plugin-${i}`)))
    renderBar()

    // A menu you have to scroll to discover is a menu whose last entries never
    // get used. The page scrolls instead.
    for (let i = 0; i < 12; i += 1) {
      // An exact name, not a pattern: /plugin-1/ also matches plugin-10 and -11.
      expect(screen.getByRole('button', { name: `plugin-${i}` })).toBeInTheDocument()
    }
    expect(document.querySelector('.agentix-scroll')).toBeNull()
  })

  it('keeps each row to a single line', () => {
    registry.push(fakePlugin('task-manager'))
    renderBar()

    // The version subtitle cost every row a second line to say almost nothing.
    expect(screen.queryByText(/Version 1\.0\.0/)).not.toBeInTheDocument()
  })
})
