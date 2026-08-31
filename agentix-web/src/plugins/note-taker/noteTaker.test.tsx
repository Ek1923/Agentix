// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAIService } from '../../core/ai'
import { deleteKey, setKey } from '../../core/ai/secure-store'
import { db } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import type { PluginContext } from '../../core/plugin-host/types'
import { activeAIConfig } from '../../core/settings/store'
import { noteTakerPlugin } from './index'

// Key-shaped but self-identifying — see the note in core/ai/ai.test.ts.
const ANTHROPIC_KEY = 'sk-ant-api03-FAKEKEYFORTESTS0001'

const navigate = vi.fn()
const ctx: PluginContext = {
  db: queries,
  ai: createAIService(activeAIConfig),
  navigate,
}

const NoteTaker = noteTakerPlugin.Component
const LONG_NOTE =
  'We agreed to ship the migration on Friday. Sam owns the rollout and will post ' +
  'the runbook on Thursday afternoon so everyone can read it beforehand.'

/** A provider reply, whatever the shape the active provider expects. */
function stubReply(text: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text }],
            choices: [{ message: { content: text } }],
          }),
          { status: 200 },
        ),
    ),
  )
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
  await deleteKey('anthropic')
  await deleteKey('openai')
  navigate.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('notes without AI', () => {
  it('shows a real empty state', async () => {
    render(<NoteTaker ctx={ctx} />)
    expect(await screen.findByText('No notes yet.')).toBeInTheDocument()
  })

  it('writes a note with no key configured', async () => {
    const user = userEvent.setup()
    render(<NoteTaker ctx={ctx} />)
    await screen.findByLabelText('New note')

    await user.type(screen.getByLabelText('New note'), 'Remember the milk')
    await user.click(screen.getByRole('button', { name: /Add note/ }))

    expect(await screen.findByText('Remember the milk')).toBeInTheDocument()
    const [saved] = await queries.listNotes()
    expect(saved?.content).toBe('Remember the milk')
    expect(saved?.aiSummary).toBeNull()
  })

  it('edits a note', async () => {
    const user = userEvent.setup()
    await queries.createNote({ content: 'First draft' })

    render(<NoteTaker ctx={ctx} />)
    await user.click(await screen.findByRole('button', { name: /Edit note/ }))

    const editor = screen.getByLabelText('Note content')
    await user.clear(editor)
    await user.type(editor, 'Second draft')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const [saved] = await queries.listNotes()
      expect(saved?.content).toBe('Second draft')
    })
  })

  it('soft deletes a note', async () => {
    const user = userEvent.setup()
    await queries.createNote({ content: 'Throwaway' })

    render(<NoteTaker ctx={ctx} />)
    await user.click(await screen.findByRole('button', { name: 'Delete note' }))

    await waitFor(async () => {
      expect(await queries.listNotes()).toEqual([])
    })
    // Still on disk, so the delete can sync like any other edit.
    expect(await db.notes.count()).toBe(1)
  })

  it('attaches a note to a recent task', async () => {
    const user = userEvent.setup()
    const task = await queries.createTask({ title: 'Ship it', plannedFor: queries.todayLocal() })

    render(<NoteTaker ctx={ctx} />)
    await screen.findByLabelText('New note')

    await user.type(screen.getByLabelText('New note'), 'Thinking about this')
    await user.selectOptions(screen.getByLabelText('Attach to a task'), task.id)
    await user.click(screen.getByRole('button', { name: /Add note/ }))

    await waitFor(async () => {
      const [saved] = await queries.listNotes()
      expect(saved?.taskId).toBe(task.id)
    })
    // Scoped to the list: the task title also appears in the composer's dropdown.
    const list = await screen.findByRole('list')
    expect(within(list).getByText('Ship it')).toBeInTheDocument()
  })

  /** The Phase 3 gate, half one: no key must degrade, never fail. */
  it('degrades cleanly without a key', async () => {
    await queries.createNote({ content: LONG_NOTE })
    render(<NoteTaker ctx={ctx} />)

    // A pointer at Settings, not an error and not a dead disabled button.
    expect(await screen.findByText('Notes work without a key.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Add a key to summarise/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Summarise$/ })).not.toBeInTheDocument()

    // And the note itself is entirely unaffected.
    expect(screen.getByText(LONG_NOTE)).toBeInTheDocument()
  })

  it('points at Settings rather than explaining nothing', async () => {
    const user = userEvent.setup()
    await queries.createNote({ content: LONG_NOTE })

    render(<NoteTaker ctx={ctx} />)
    await user.click(await screen.findByRole('button', { name: /Add a key to summarise/ }))

    expect(navigate).toHaveBeenCalledWith('settings')
  })
})

describe('notes with AI', () => {
  beforeEach(async () => {
    await setKey('anthropic', ANTHROPIC_KEY)
  })

  /** The Phase 3 gate, half two: with a key it actually works. */
  it('summarises a note and stores the result', async () => {
    const user = userEvent.setup()
    stubReply('They ship the migration on Friday; Sam owns the rollout.')
    await queries.createNote({ content: LONG_NOTE })

    render(<NoteTaker ctx={ctx} />)
    await user.click(await screen.findByRole('button', { name: 'Summarise' }))

    expect(
      await screen.findByText('They ship the migration on Friday; Sam owns the rollout.'),
    ).toBeInTheDocument()

    const [saved] = await queries.listNotes()
    expect(saved?.aiSummary).toBe('They ship the migration on Friday; Sam owns the rollout.')
    // The note itself is never rewritten by the model.
    expect(saved?.content).toBe(LONG_NOTE)
  })

  it('cleans a reply that arrives wrapped in quotes and a preamble', async () => {
    const user = userEvent.setup()
    stubReply('Summary: "They ship on Friday."')
    await queries.createNote({ content: LONG_NOTE })

    render(<NoteTaker ctx={ctx} />)
    await user.click(await screen.findByRole('button', { name: 'Summarise' }))

    await waitFor(async () => {
      const [saved] = await queries.listNotes()
      expect(saved?.aiSummary).toBe('They ship on Friday.')
    })
  })

  it('sends the note and the task title in the prompt', async () => {
    const user = userEvent.setup()
    let sentBody = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        sentBody = String(init?.body ?? '')
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
          status: 200,
        })
      }),
    )

    const task = await queries.createTask({
      title: 'Ship the migration',
      plannedFor: queries.todayLocal(),
    })
    await queries.createNote({ content: LONG_NOTE, taskId: task.id })

    render(<NoteTaker ctx={ctx} />)
    await user.click(await screen.findByRole('button', { name: 'Summarise' }))

    await waitFor(() => expect(sentBody).not.toBe(''))
    expect(sentBody).toContain('Ship the migration')
    expect(sentBody).toContain('BEGIN NOTE')
    // The key travels as a header, never in the body.
    expect(sentBody).not.toContain(ANTHROPIC_KEY)
  })

  it('offers no summary on a note too short to be worth one', async () => {
    await queries.createNote({ content: 'Bought milk' })
    render(<NoteTaker ctx={ctx} />)

    expect(await screen.findByRole('button', { name: 'Summarise' })).toBeDisabled()
  })

  it('reports a rejected key without breaking the note', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await queries.createNote({ content: LONG_NOTE })

    render(<NoteTaker ctx={ctx} />)
    await user.click(await screen.findByRole('button', { name: 'Summarise' }))

    expect(await screen.findByText(/Key rejected/)).toBeInTheDocument()
    // The note survives a failed summary.
    expect(screen.getByText(LONG_NOTE)).toBeInTheDocument()
    const [saved] = await queries.listNotes()
    expect(saved?.aiSummary).toBeNull()
  })

  it('never puts the key into an error shown on screen', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`connect failed for x-api-key ${ANTHROPIC_KEY}`)
      }),
    )
    await queries.createNote({ content: LONG_NOTE })

    render(<NoteTaker ctx={ctx} />)
    await user.click(await screen.findByRole('button', { name: 'Summarise' }))

    await screen.findByText(/Could not reach Anthropic/)
    expect(document.body.textContent).not.toContain(ANTHROPIC_KEY)
    expect(document.body.textContent).not.toContain('sk-ant')
  })

  it('re-summarises an already summarised note', async () => {
    const user = userEvent.setup()
    stubReply('Second pass.')
    await queries.createNote({ content: LONG_NOTE, aiSummary: 'First pass.' })

    render(<NoteTaker ctx={ctx} />)
    await user.click(await screen.findByRole('button', { name: 'Re-summarise' }))

    expect(await screen.findByText('Second pass.')).toBeInTheDocument()
  })
})

describe('searching', () => {
  it('filters once there are enough notes to need it', async () => {
    const user = userEvent.setup()
    for (const content of ['Roadmap meeting', 'Groceries', 'Dentist', 'Roadmap follow-up']) {
      await queries.createNote({ content })
    }

    render(<NoteTaker ctx={ctx} />)
    await user.type(await screen.findByLabelText('Search notes'), 'roadmap')

    await waitFor(() => {
      expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    })
    const list = screen.getByRole('list')
    expect(within(list).getByText('Roadmap meeting')).toBeInTheDocument()
    expect(within(list).getByText('Roadmap follow-up')).toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    for (const content of ['One', 'Two', 'Three', 'Four']) {
      await queries.createNote({ content })
    }

    render(<NoteTaker ctx={ctx} />)
    await user.type(await screen.findByLabelText('Search notes'), 'zzzz')

    expect(await screen.findByText('Nothing matches that.')).toBeInTheDocument()
  })
})
