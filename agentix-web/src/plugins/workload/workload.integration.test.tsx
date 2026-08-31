// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAIService } from '../../core/ai'
import { shiftDay } from '../../core/dates'
import { db } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import type { PluginContext } from '../../core/plugin-host/types'
import { activeAIConfig } from '../../core/settings/store'
import { workloadPlugin } from './index'

const ctx: PluginContext = {
  db: queries,
  ai: createAIService(activeAIConfig),
  navigate: () => {},
}

const Workload = workloadPlugin.Component
const today = () => queries.todayLocal()
const inDays = (n: number) => shiftDay(today(), n)

/** Tracks `minutes` on a day `daysAgo` back, so capacity has something to measure. */
async function trackDay(minutes: number, daysAgo: number) {
  const task = await queries.createTask({
    title: `history-${daysAgo}`,
    plannedFor: shiftDay(today(), -daysAgo),
  })
  const session = await queries.startSession(task.id)
  const noon = new Date()
  noon.setDate(noon.getDate() - daysAgo)
  noon.setHours(12, 0, 0, 0)
  await db.sessions.update(session.id, {
    startedAt: noon.toISOString(),
    endedAt: new Date(noon.getTime() + minutes * 60_000).toISOString(),
  })
  await queries.setTaskDone(task.id, true)
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

describe('measuring capacity', () => {
  it('refuses to invent a working day before there is evidence', async () => {
    render(<Workload ctx={ctx} />)
    // No eight-hour default: it says what it does not know.
    expect(await screen.findByText(/Not enough tracked days yet/)).toBeInTheDocument()
    expect(screen.getByText(/0 of 3 needed/)).toBeInTheDocument()
  })

  it('reports a measured day once there is enough evidence', async () => {
    await trackDay(120, 1)
    await trackDay(180, 2)
    await trackDay(240, 3)

    render(<Workload ctx={ctx} />)
    expect(await screen.findByText('3h')).toBeInTheDocument()
    expect(screen.getByText(/from 3 measured days/)).toBeInTheDocument()
  })
})

describe('the days ahead', () => {
  it('shows a clear road when nothing is planned', async () => {
    render(<Workload ctx={ctx} />)
    expect(await screen.findByText('The road ahead is clear.')).toBeInTheDocument()
  })

  it('sums estimates onto the day they are planned for', async () => {
    await queries.createTask({ title: 'A', plannedFor: today(), estimateMin: 60 })
    await queries.createTask({ title: 'B', plannedFor: today(), estimateMin: 30 })

    render(<Workload ctx={ctx} />)
    expect(await screen.findByText(/2 tasks · 1h 30m/)).toBeInTheDocument()
  })

  it('marks a day with nothing on it as free', async () => {
    render(<Workload ctx={ctx} />)
    const free = await screen.findAllByText('free')
    expect(free.length).toBeGreaterThan(0)
  })

  it('flags work that carries no estimate rather than hiding it', async () => {
    await queries.createTask({ title: 'Unsized', plannedFor: today() })

    render(<Workload ctx={ctx} />)
    expect(
      await screen.findByText(/1 without an estimate — this day may be heavier/),
    ).toBeInTheDocument()
  })

  it('leaves finished work out, since it is no longer load', async () => {
    const task = await queries.createTask({
      title: 'Already done',
      plannedFor: today(),
      estimateMin: 120,
    })
    await queries.setTaskDone(task.id, true)

    render(<Workload ctx={ctx} />)
    expect(await screen.findByText('The road ahead is clear.')).toBeInTheDocument()
  })

  it('changes horizon', async () => {
    const user = userEvent.setup()
    await queries.createTask({ title: 'Later', plannedFor: inDays(10), estimateMin: 60 })

    render(<Workload ctx={ctx} />)
    await screen.findByText(/Nothing planned in the next 7 days/)

    await user.click(screen.getByRole('radio', { name: 'Next 14 days' }))
    expect(await screen.findByText(/1h planned over 14 days/)).toBeInTheDocument()
  })
})

describe('overcommitment', () => {
  it('says nothing about overload while capacity is unknown', async () => {
    // Grading a plan against a number nobody has hit would be a fabricated warning.
    await queries.createTask({ title: 'Huge', plannedFor: today(), estimateMin: 600 })

    render(<Workload ctx={ctx} />)
    await screen.findByText(/Not enough tracked days yet/)
    expect(screen.queryByText(/planned beyond what a typical day/)).not.toBeInTheDocument()
  })

  it('warns once a day is planned past a proven day', async () => {
    await trackDay(120, 1)
    await trackDay(120, 2)
    await trackDay(120, 3)
    await queries.createTask({ title: 'Too much', plannedFor: today(), estimateMin: 300 })

    render(<Workload ctx={ctx} />)
    expect(
      await screen.findByText(/1 day planned beyond what a typical day of yours has held/),
    ).toBeInTheDocument()
  })

  it('does not warn about a day that fits', async () => {
    await trackDay(240, 1)
    await trackDay(240, 2)
    await trackDay(240, 3)
    await queries.createTask({ title: 'Fits', plannedFor: today(), estimateMin: 60 })

    render(<Workload ctx={ctx} />)
    await screen.findByText(/from 3 measured days/)
    expect(screen.queryByText(/planned beyond what a typical day/)).not.toBeInTheDocument()
  })
})

describe('per person', () => {
  it('reports what is on each tagged person plate', async () => {
    const alice = await queries.createPerson('Alice', 'ocean')
    const bob = await queries.createPerson('Bob', 'ember')
    await queries.createTask({
      title: 'Hers',
      plannedFor: today(),
      estimateMin: 90,
      assigneeIds: [alice.id],
    })
    await queries.createTask({
      title: 'His',
      plannedFor: today(),
      estimateMin: 30,
      assigneeIds: [bob.id],
    })

    render(<Workload ctx={ctx} />)
    await screen.findByText('On each plate')

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('1 · 1h 30m')).toBeInTheDocument()
    expect(screen.getByText('1 · 30m')).toBeInTheDocument()
  })

  it('leaves people with nothing assigned out of the list', async () => {
    await queries.createPerson('Nobody', 'slate')
    await queries.createTask({ title: 'Unassigned', plannedFor: today(), estimateMin: 30 })

    render(<Workload ctx={ctx} />)
    await screen.findByText(/1 task · 30m/)
    expect(screen.queryByText('On each plate')).not.toBeInTheDocument()
  })
})
