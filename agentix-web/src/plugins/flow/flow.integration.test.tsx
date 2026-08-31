// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAIService } from '../../core/ai'
import { shiftDay } from '../../core/dates'
import { db, DEFAULT_BUCKET_IDS } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import type { PluginContext } from '../../core/plugin-host/types'
import { activeAIConfig } from '../../core/settings/store'
import { flowPlugin } from './index'

const ctx: PluginContext = {
  db: queries,
  ai: createAIService(activeAIConfig),
  navigate: () => {},
}

const Flow = flowPlugin.Component
const today = () => queries.todayLocal()
const daysAgo = (n: number) => shiftDay(today(), -n)

/** A closed session of `minutes`, ending `endedDaysAgo` days back. */
async function trackMinutes(taskId: string, minutes: number, endedDaysAgo = 1) {
  const session = await queries.startSession(taskId)
  const end = Date.now() - endedDaysAgo * 86_400_000
  await db.sessions.update(session.id, {
    startedAt: new Date(end - minutes * 60_000).toISOString(),
    endedAt: new Date(end).toISOString(),
  })
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
  await queries.ensureDefaultBuckets()
})

afterEach(cleanup)

describe('Flow', () => {
  it('says there is nothing to measure rather than showing zeroes', async () => {
    render(<Flow ctx={ctx} />)
    expect(await screen.findByText('Nothing to measure yet.')).toBeInTheDocument()
  })

  it('reports finished work and throughput', async () => {
    for (let i = 0; i < 3; i++) {
      const task = await queries.createTask({ title: `Done ${i}`, plannedFor: daysAgo(2) })
      await queries.setTaskDone(task.id, true)
    }

    render(<Flow ctx={ctx} />)
    await screen.findByText('Finished')
    expect(screen.getByText('0.1/day')).toBeInTheDocument()
  })

  it('separates work merely open from work in flight', async () => {
    await queries.createTask({ title: 'Listed', plannedFor: today() })
    const started = await queries.createTask({ title: 'Started', plannedFor: today() })
    await trackMinutes(started.id, 30)

    render(<Flow ctx={ctx} />)
    expect(await screen.findByText('1 started')).toBeInTheDocument()
  })

  it('shows a dash where nothing has been measured, never a zero', async () => {
    // An open task gives a board to report on but no completed work to time.
    await queries.createTask({ title: 'Open', plannedFor: today() })

    render(<Flow ctx={ctx} />)
    await screen.findByText('Lead time')
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('breaks open work down by column, excluding done ones', async () => {
    await queries.createTask({ title: 'Waiting', plannedFor: today() })
    const finished = await queries.createTask({ title: 'Finished', plannedFor: today() })
    await queries.setTaskDone(finished.id, true)

    render(<Flow ctx={ctx} />)
    // findBy, not getBy: the columns arrive from their own live query, a tick
    // after the section heading is on screen.
    expect(await screen.findByText('To do')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    // Done is not load.
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })

  it('surfaces work that was started and then abandoned', async () => {
    const stalled = await queries.createTask({ title: 'Abandoned', plannedFor: daysAgo(8) })
    await trackMinutes(stalled.id, 40, 7)

    render(<Flow ctx={ctx} />)
    expect(await screen.findByText(/Started, then left/)).toBeInTheDocument()
    expect(screen.getByText('Abandoned')).toBeInTheDocument()
    expect(screen.getByText('7d idle')).toBeInTheDocument()
  })

  it('does not call never-started work stalled', async () => {
    await queries.createTask({ title: 'Only planned', plannedFor: daysAgo(10) })

    render(<Flow ctx={ctx} />)
    await screen.findByText('To do')
    expect(screen.queryByText(/Started, then left/)).not.toBeInTheDocument()
  })

  it('narrows and widens the window', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Twenty days ago', plannedFor: daysAgo(20) })

    render(<Flow ctx={ctx} />)
    await screen.findByText('Where open work sits')

    await user.click(screen.getByRole('radio', { name: 'Last 7 days' }))
    expect(await screen.findByText('Nothing to measure yet.')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }))
    expect(await screen.findByText('Where open work sits')).toBeInTheDocument()
  })

  it('offers a CSV export only when there is something to export', async () => {
    render(<Flow ctx={ctx} />)
    expect(await screen.findByRole('button', { name: /CSV/ })).toBeDisabled()

    cleanup()
    await queries.createTask({ title: 'Exportable', plannedFor: today() })
    render(<Flow ctx={ctx} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /CSV/ })).toBeEnabled()
    })
  })

  it('files each task in the column it points at', async () => {
    await queries.createTask({
      title: 'Active work',
      plannedFor: today(),
      status: 'active',
      bucketId: DEFAULT_BUCKET_IDS.active,
    })

    render(<Flow ctx={ctx} />)
    // One open task, all of it in In progress.
    expect(await screen.findByText('1 · 100%')).toBeInTheDocument()
  })
})
