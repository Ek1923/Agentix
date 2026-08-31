// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../core/db/db'
import { queries } from '../core/db/queries'
import { useSettings } from '../core/settings/store'
import { TodayHero } from './TodayHero'

const today = () => queries.todayLocal()

/** Freezes the clock so the greeting under test is the one being asserted. */
function atHour(hour: number) {
  const fixed = new Date()
  fixed.setHours(hour, 0, 0, 0)
  vi.setSystemTime(fixed)
}

async function trackMinutes(taskId: string, minutes: number) {
  const session = await queries.startSession(taskId)
  const end = Date.now() - 60_000
  await db.sessions.update(session.id, {
    startedAt: new Date(end - minutes * 60_000).toISOString(),
    endedAt: new Date(end).toISOString(),
  })
}

beforeEach(async () => {
  await db.open()
  await Promise.all([db.tasks.clear(), db.sessions.clear(), db.buckets.clear()])
  await queries.ensureDefaultBuckets()
  useSettings.setState({ displayName: '' })
})

afterEach(cleanup)

describe('the greeting', () => {
  // Only here. Fake timers stall Dexie's transaction lifecycle, so the tests that
  // write to the database run on the real clock.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('follows the hour', async () => {
    const cases: Array<[number, string]> = [
      [3, 'Still up'],
      [9, 'Good morning'],
      [14, 'Good afternoon'],
      [21, 'Good evening'],
    ]

    for (const [hour, expected] of cases) {
      atHour(hour)
      render(<TodayHero db={queries} />)
      expect(await screen.findByRole('heading', { name: new RegExp(expected) })).toBeInTheDocument()
      cleanup()
    }
  })

  it('uses the first name only, because a greeting is not a form field', async () => {
    atHour(9)
    useSettings.setState({ displayName: 'Ege Baykal' })

    render(<TodayHero db={queries} />)
    const heading = await screen.findByRole('heading')

    expect(heading.textContent).toContain('Ege')
    expect(heading.textContent).not.toContain('Baykal')
  })

  it('greets without a name when none is set', async () => {
    atHour(9)
    render(<TodayHero db={queries} />)

    const heading = await screen.findByRole('heading')
    expect(heading.textContent?.trim()).toBe('Good morning')
  })
})

describe('the day so far', () => {
  it('invites rather than showing a row of zeroes', async () => {
    // A dashboard of noughts reads as failure when it only means the day has
    // not started.
    render(<TodayHero db={queries} />)

    expect(await screen.findByText(/Nothing planned yet/)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('counts what is done against what is planned', async () => {
    const done = await queries.createTask({ title: 'Finished', plannedFor: today() })
    await queries.createTask({ title: 'Open', plannedFor: today() })
    await queries.setTaskDone(done.id, true)

    render(<TodayHero db={queries} />)

    expect(await screen.findByText('Done today')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Progress today' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
  })

  it('sums tracked time across the day', async () => {
    const task = await queries.createTask({ title: 'Worked', plannedFor: today() })
    await trackMinutes(task.id, 90)

    render(<TodayHero db={queries} />)
    expect(await screen.findByText('1h 30m')).toBeInTheDocument()
  })

  it('shows a dash for untracked time, never a zero', async () => {
    await queries.createTask({ title: 'Planned only', plannedFor: today() })

    render(<TodayHero db={queries} />)
    await screen.findByText('Tracked')
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('ignores work planned for another day', async () => {
    await queries.createTask({ title: 'Not today', plannedFor: '2020-01-01' })

    render(<TodayHero db={queries} />)
    expect(await screen.findByText(/Nothing planned yet/)).toBeInTheDocument()
  })
})
