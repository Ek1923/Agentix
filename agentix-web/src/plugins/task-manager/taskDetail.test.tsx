// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAIService } from '../../core/ai'
import { db } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import type { PluginContext } from '../../core/plugin-host/types'
import { activeAIConfig } from '../../core/settings/store'
import { taskManagerPlugin } from './index'

const ctx: PluginContext = {
  db: queries,
  ai: createAIService(activeAIConfig),
  navigate: () => {},
}

const TaskManager = taskManagerPlugin.Component
const today = () => queries.todayLocal()

function waitForBoard() {
  return screen.findByRole('region', { name: 'To do' })
}

async function openTask(user: ReturnType<typeof userEvent.setup>, title: string) {
  await screen.findByText(title)
  await user.click(screen.getByRole('button', { name: title }))
  return screen.findByRole('dialog', { name: title })
}

beforeEach(async () => {
  await db.open()
  await Promise.all([
    db.tasks.clear(),
    db.sessions.clear(),
    db.notes.clear(),
    db.buckets.clear(),
    db.people.clear(),
  ])
})

afterEach(cleanup)

describe('task panel', () => {
  it('opens from the card title and closes again', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Open me', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Open me')

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Escapable', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    await openTask(user, 'Escapable')

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('renames the task on blur', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Old name', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Old name')

    const title = within(dialog).getByLabelText('Task title')
    await user.clear(title)
    await user.type(title, 'New name')
    await user.tab()

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.title).toBe('New name')
    })
  })

  it('refuses to blank out a title', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Keep me', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Keep me')

    const title = within(dialog).getByLabelText('Task title')
    await user.clear(title)
    await user.tab()

    const [task] = await queries.listTasksByDay(today())
    expect(task?.title).toBe('Keep me')
  })

  it('changes priority from the panel', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Bump me', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Bump me')

    await user.click(within(dialog).getByRole('radio', { name: 'Urgent' }))

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.priority).toBe(2)
    })
  })
})

describe('the link', () => {
  it('saves a link typed without a scheme, and shows the host large', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Needs a link', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Needs a link')

    await user.type(within(dialog).getByLabelText('Link'), 'example.com/file/abc')
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }))

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.link).toBe('https://example.com/file/abc')
    })

    // The host is the headline; the path is the subtitle.
    const link = await screen.findByRole('link', { name: /example\.com/ })
    expect(link).toHaveAttribute('href', 'https://example.com/file/abc')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('refuses a script-scheme link rather than putting it in an href', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Hostile', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Hostile')

    await user.type(within(dialog).getByLabelText('Link'), 'javascript:alert(1)')

    expect(within(dialog).getByRole('button', { name: 'Save link' })).toBeDisabled()
    expect(within(dialog).getByText(/not a web address/i)).toBeInTheDocument()
  })

  it('removes a link', async () => {
    const user = userEvent.setup()
    await queries.createTask({
      title: 'Has a link',
      plannedFor: today(),
      link: 'https://example.com/',
    })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Has a link')

    await user.click(within(dialog).getByRole('button', { name: 'Edit' }))
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.link).toBeNull()
    })
  })

  it('shows the host on the card too', async () => {
    await queries.createTask({
      title: 'Linked',
      plannedFor: today(),
      link: 'https://www.example.com/a',
    })

    render(<TaskManager ctx={ctx} />)
    await waitForBoard()

    expect(await screen.findByText('example.com')).toBeInTheDocument()
  })
})

describe('people', () => {
  it('creates a person and tags them on a task', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Shared work', plannedFor: today() })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Shared work')

    await user.click(within(dialog).getByRole('button', { name: /Add person/ }))
    await user.type(within(dialog).getByLabelText('Person name'), 'Ege Baykal')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    const chip = await within(dialog).findByRole('checkbox', { name: 'Ege Baykal' })
    await user.click(chip)

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      const [person] = await queries.listPeople()
      expect(task?.assigneeIds).toEqual([person!.id])
    })
  })

  it('untags someone without deleting them', async () => {
    const user = userEvent.setup()
    const person = await queries.createPerson('Sam', 'ocean')
    await queries.createTask({
      title: 'Tagged',
      plannedFor: today(),
      assigneeIds: [person.id],
    })

    render(<TaskManager ctx={ctx} />)
    const dialog = await openTask(user, 'Tagged')

    await user.click(within(dialog).getByRole('checkbox', { name: 'Sam' }))

    await waitFor(async () => {
      const [task] = await queries.listTasksByDay(today())
      expect(task?.assigneeIds).toEqual([])
    })
    expect(await queries.listPeople()).toHaveLength(1)
  })

  it('deleting a person untags them everywhere', async () => {
    const person = await queries.createPerson('Gone', 'ember')
    await queries.createTask({
      title: 'Was tagged',
      plannedFor: today(),
      assigneeIds: [person.id],
    })

    await queries.deletePerson(person.id)

    // No task may point at somebody who no longer exists.
    const [task] = await queries.listTasksByDay(today())
    expect(task?.assigneeIds).toEqual([])
    expect(await queries.listPeople()).toEqual([])
  })
})
