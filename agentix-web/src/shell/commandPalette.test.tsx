// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../core/db/db'
import { queries } from '../core/db/queries'
import { CommandPalette } from './CommandPalette'

const today = () => queries.todayLocal()

function renderPalette(open = true) {
  const onClose = vi.fn()
  const onNavigate = vi.fn()
  render(
    <CommandPalette db={queries} open={open} onClose={onClose} onNavigate={onNavigate} />,
  )
  return { onClose, onNavigate }
}

beforeEach(async () => {
  await db.open()
  await Promise.all([db.tasks.clear(), db.notes.clear(), db.buckets.clear()])
  await queries.ensureDefaultBuckets()
})

afterEach(cleanup)

describe('the command palette', () => {
  it('is absent while closed', () => {
    renderPalette(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists every plugin and shell destination when empty', async () => {
    renderPalette()
    const dialog = await screen.findByRole('dialog', { name: 'Search and jump' })

    expect(within(dialog).getByText('Task Manager')).toBeInTheDocument()
    expect(within(dialog).getByText('Habits')).toBeInTheDocument()
    expect(within(dialog).getByText('Settings')).toBeInTheDocument()
  })

  it('finds a task by title', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Ship the migration', plannedFor: today() })

    renderPalette()
    await user.type(await screen.findByLabelText(/Search tasks/), 'migration')

    expect(await screen.findByText('Ship the migration')).toBeInTheDocument()
  })

  it('finds a task by one of its tags', async () => {
    const user = userEvent.setup()
    await queries.createTask({
      title: 'Untitled match',
      plannedFor: today(),
      tags: ['invoices'],
    })

    renderPalette()
    await user.type(await screen.findByLabelText(/Search tasks/), 'invoic')

    expect(await screen.findByText('Untitled match')).toBeInTheDocument()
  })

  it('finds a note by its content', async () => {
    const user = userEvent.setup()
    await queries.createNote({ content: 'Remember the runbook link' })

    renderPalette()
    await user.type(await screen.findByLabelText(/Search tasks/), 'runbook')

    expect(await screen.findByText('Remember the runbook link')).toBeInTheDocument()
  })

  it('ignores soft-deleted rows', async () => {
    const user = userEvent.setup()
    const task = await queries.createTask({ title: 'Deleted thing', plannedFor: today() })
    await queries.deleteTask(task.id)

    renderPalette()
    await user.type(await screen.findByLabelText(/Search tasks/), 'Deleted')

    await waitFor(() => {
      expect(screen.getByText('Nothing matches that.')).toBeInTheDocument()
    })
  })

  it('jumps to a plugin when one is chosen', async () => {
    const user = userEvent.setup()
    const { onNavigate, onClose } = renderPalette()

    await user.click(await screen.findByRole('option', { name: /Task Manager/ }))

    expect(onNavigate).toHaveBeenCalledWith('task-manager')
    expect(onClose).toHaveBeenCalled()
  })

  it('sends a note hit to Note Taker rather than opening it in place', async () => {
    const user = userEvent.setup()
    await queries.createNote({ content: 'Findable note' })
    const { onNavigate } = renderPalette()

    await user.type(await screen.findByLabelText(/Search tasks/), 'Findable')
    await user.click(await screen.findByRole('option', { name: /Findable note/ }))

    expect(onNavigate).toHaveBeenCalledWith('note-taker')
  })

  it('moves the selection with the arrow keys and opens on Enter', async () => {
    const user = userEvent.setup()
    const { onNavigate } = renderPalette()

    const input = await screen.findByLabelText(/Search tasks/)
    await user.type(input, '{ArrowDown}{Enter}')

    // Second row: Agenda follows Task Manager in the registry.
    expect(onNavigate).toHaveBeenCalledWith('agenda')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPalette()

    await user.type(await screen.findByLabelText(/Search tasks/), '{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    renderPalette()

    await user.type(await screen.findByLabelText(/Search tasks/), 'zzzzzz')
    expect(await screen.findByText('Nothing matches that.')).toBeInTheDocument()
  })
})
