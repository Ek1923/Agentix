// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { levelUp } from '../../core/rank'
import { LevelUpToast } from './LevelUpToast'

const { feedback } = vi.hoisted(() => ({ feedback: vi.fn() }))
vi.mock('../feedback', () => ({ feedback }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the level-up moment', () => {
  it('shows nothing at all when nothing was crossed', () => {
    render(<LevelUpToast celebration={null} onDismiss={() => {}} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('announces a level politely, without stealing focus', () => {
    render(<LevelUpToast celebration={levelUp(2, 3)} onDismiss={() => {}} />)

    const moment = screen.getByRole('status')
    expect(moment).toHaveAttribute('aria-live', 'polite')
    expect(moment).toHaveTextContent('Level up')
    expect(moment).toHaveTextContent('Level 3')
    expect(document.body).toHaveFocus()
  })

  it('names the rank when the climb opened one', () => {
    render(<LevelUpToast celebration={levelUp(4, 5)} onDismiss={() => {}} />)

    expect(screen.getByRole('status')).toHaveTextContent('Promoted')
    expect(screen.getByRole('status')).toHaveTextContent('You’re a Junior')
  })

  it('fires the feedback the iOS build maps to a haptic', () => {
    render(<LevelUpToast celebration={levelUp(1, 2)} onDismiss={() => {}} />)

    expect(feedback).toHaveBeenCalledWith('success')
  })

  it('can be dismissed by hand', async () => {
    const onDismiss = vi.fn()
    render(<LevelUpToast celebration={levelUp(1, 2)} onDismiss={onDismiss} />)

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalled()
  })

  it('closes on Escape, like everything else', () => {
    const onDismiss = vi.fn()
    render(<LevelUpToast celebration={levelUp(1, 2)} onDismiss={onDismiss} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onDismiss).toHaveBeenCalled()
  })

  it('withdraws on its own, so the reward never becomes a chore', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<LevelUpToast celebration={levelUp(1, 2)} onDismiss={onDismiss} />)

    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(7000)
    })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
