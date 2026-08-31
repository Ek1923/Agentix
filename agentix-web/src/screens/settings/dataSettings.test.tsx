// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../core/db/db'
import { isBackup, queries } from '../../core/db/queries'
import { DataSettings } from './DataSettings'

const today = () => queries.todayLocal()

beforeEach(async () => {
  await db.open()
  await Promise.all([
    db.tasks.clear(),
    db.sessions.clear(),
    db.notes.clear(),
    db.buckets.clear(),
    db.people.clear(),
    db.habits.clear(),
    db.habitLogs.clear(),
  ])

  // jsdom has no object URLs and no real downloads.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('backup', () => {
  it('exports every row, including soft-deleted ones', async () => {
    const task = await queries.createTask({ title: 'Deleted later', plannedFor: today() })
    await queries.deleteTask(task.id)
    await queries.createTask({ title: 'Still here', plannedFor: today() })

    const backup = await queries.exportBackup()

    // Dropping deleted rows would silently purge the trash on the next restore.
    expect(backup.tasks).toHaveLength(2)
    expect(backup.format).toBe('agentix-backup')
  })

  it('recognises its own file and rejects anything else', async () => {
    expect(isBackup(await queries.exportBackup())).toBe(true)
    expect(isBackup({ format: 'something-else' })).toBe(false)
    expect(isBackup(null)).toBe(false)
    expect(isBackup({ format: 'agentix-backup', version: 1 })).toBe(false)
  })

  it('replaces everything on restore', async () => {
    await queries.createTask({ title: 'Original', plannedFor: today() })
    const backup = await queries.exportBackup()

    await queries.createTask({ title: 'Added after the backup', plannedFor: today() })
    expect(await queries.listTasksByDay(today())).toHaveLength(2)

    await queries.importBackup(backup)

    const tasks = await queries.listTasksByDay(today())
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.title).toBe('Original')
  })

  it('asks before replacing anything', async () => {
    const user = userEvent.setup()
    render(<DataSettings />)

    await user.click(await screen.findByRole('button', { name: /Restore from file/ }))
    expect(
      screen.getByText(/Restoring replaces everything currently on this device/),
    ).toBeInTheDocument()
  })

  it('refuses a file that is not a backup, without touching the data', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Untouched', plannedFor: today() })

    render(<DataSettings />)
    await user.click(await screen.findByRole('button', { name: /Restore from file/ }))

    const input = screen.getByLabelText('Backup file')
    await user.upload(
      input,
      new File(['{"hello":"world"}'], 'not-a-backup.json', { type: 'application/json' }),
    )

    expect(
      await screen.findByText('That is not an Agentix backup file.'),
    ).toBeInTheDocument()
    expect(await queries.listTasksByDay(today())).toHaveLength(1)
  })
})

describe('recently deleted', () => {
  it('says nothing is deleted when nothing is', async () => {
    render(<DataSettings />)
    expect(await screen.findByText('Nothing deleted.')).toBeInTheDocument()
  })

  it('lists a soft-deleted task and puts it back', async () => {
    const user = userEvent.setup()
    const task = await queries.createTask({ title: 'Gone for now', plannedFor: today() })
    await queries.deleteTask(task.id)

    render(<DataSettings />)
    await user.click(await screen.findByRole('button', { name: /Restore "Gone for now"/ }))

    await waitFor(async () => {
      const restored = await queries.getTask(task.id)
      expect(restored?.deletedAt).toBeNull()
    })
    expect(await screen.findByText('Nothing deleted.')).toBeInTheDocument()
  })

  it('covers every kind of soft delete, not just tasks', async () => {
    const note = await queries.createNote({ content: 'A deleted note' })
    await queries.deleteNote(note.id)
    const person = await queries.createPerson('Deleted person', 'ocean')
    await queries.deletePerson(person.id)
    const habit = await queries.createHabit('Deleted routine', [], null, 'ember')
    await queries.deleteHabit(habit.id)

    render(<DataSettings />)

    expect(await screen.findByText('A deleted note')).toBeInTheDocument()
    expect(screen.getByText('Deleted person')).toBeInTheDocument()
    expect(screen.getByText('Deleted routine')).toBeInTheDocument()
  })
})
