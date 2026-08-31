// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../core/db/db'
import { queries } from '../core/db/queries'
import { __resetRankStore, useLevelUp, useRank } from './useRank'

/** 25 XP a piece: the estimate and the priority both count. */
async function finishWorthyTask(title: string) {
  const task = await queries.createTask({ title, estimateMin: 30, priority: 2 })
  await queries.setTaskDone(task.id, true)
}

function Readout() {
  const { snapshot } = useRank()
  return (
    <div>
      <span data-testid="level">{snapshot.level.level}</span>
      <span data-testid="done">{snapshot.completedTotal}</span>
    </div>
  )
}

function Celebration() {
  const { celebration, dismiss } = useLevelUp()
  return (
    <div>
      <span data-testid="celebration">
        {celebration === null ? 'none' : `${celebration.from}->${celebration.to}`}
      </span>
      <button type="button" onClick={dismiss}>
        dismiss
      </button>
    </div>
  )
}

beforeEach(async () => {
  await db.open()
  await Promise.all([db.tasks.clear(), db.sessions.clear(), db.buckets.clear()])
  await queries.ensureDefaultBuckets()
  __resetRankStore()
})

afterEach(() => {
  cleanup()
  __resetRankStore()
})

describe('the shared rank store', () => {
  it('reads the score out of storage on first mount', async () => {
    await finishWorthyTask('Already done')

    render(<Readout />)

    await waitFor(() => expect(screen.getByTestId('done')).toHaveTextContent('1'))
  })

  it('follows work as it is finished, with nobody asking it to', async () => {
    render(<Readout />)
    await waitFor(() => expect(screen.getByTestId('done')).toHaveTextContent('0'))

    await finishWorthyTask('Finished while watching')

    await waitFor(() => expect(screen.getByTestId('done')).toHaveTextContent('1'))
  })

  it('computes once for however many surfaces are showing it', async () => {
    const read = vi.spyOn(queries, 'allTasks')

    render(
      <>
        <Readout />
        <Celebration />
      </>,
    )
    await waitFor(() => expect(read).toHaveBeenCalled())

    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('the level-up moment', () => {
  it('says nothing about a score it is meeting for the first time', async () => {
    // Three worthy tasks is 75 XP — past the 60 that level 2 costs.
    for (const n of [1, 2, 3]) await finishWorthyTask(`Before this device ${n}`)

    render(
      <>
        <Readout />
        <Celebration />
      </>,
    )

    await waitFor(() => expect(screen.getByTestId('level')).toHaveTextContent('2'))
    expect(screen.getByTestId('celebration')).toHaveTextContent('none')
  })

  it('raises the moment when the level is crossed while watching, once', async () => {
    render(<Celebration />)
    await waitFor(() => expect(screen.getByTestId('celebration')).toHaveTextContent('none'))

    for (const n of [1, 2, 3]) await finishWorthyTask(`Watched ${n}`)

    await waitFor(() => expect(screen.getByTestId('celebration')).toHaveTextContent('1->2'))

    // Another finish that crosses nothing leaves the moment as it was.
    await finishWorthyTask('One more')
    await waitFor(() => expect(screen.getByTestId('celebration')).toHaveTextContent('1->2'))
  })

  it('is over once it is acknowledged', async () => {
    render(<Celebration />)
    for (const n of [1, 2, 3]) await finishWorthyTask(`Watched ${n}`)
    await waitFor(() => expect(screen.getByTestId('celebration')).toHaveTextContent('1->2'))

    await userEvent.click(screen.getByRole('button', { name: 'dismiss' }))

    expect(screen.getByTestId('celebration')).toHaveTextContent('none')
  })

  it('delivers a level earned while the app was closed, late rather than never', async () => {
    for (const n of [1, 2, 3]) await finishWorthyTask(`Last night ${n}`)
    // What the previous session had already shown this person.
    localStorage.setItem('agentix.rank.seenLevel', '1')

    render(<Celebration />)

    await waitFor(() => expect(screen.getByTestId('celebration')).toHaveTextContent('1->2'))
  })
})
