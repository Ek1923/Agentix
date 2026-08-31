// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettings } from '../core/settings/store'
import { AVATARS, BACKGROUNDS, resolveAvatar, resolveBackground } from '../ui/avatars'
import { Profile } from './Profile'

beforeEach(() => {
  localStorage.clear()
  useSettings.setState({
    displayName: '',
    avatarId: 'initials',
    avatarBackgroundId: 'slate',
  })
})

afterEach(cleanup)

describe('Profile screen', () => {
  it('edits the name and keeps it', async () => {
    const user = userEvent.setup()
    render(<Profile onBack={() => {}} />)

    await user.type(screen.getByLabelText('Display name'), 'Ege Baykal')

    expect(useSettings.getState().displayName).toBe('Ege Baykal')
    expect(screen.getAllByText('Ege Baykal').length).toBeGreaterThan(0)
  })

  it('derives initials from the name, first and last', async () => {
    const user = userEvent.setup()
    render(<Profile onBack={() => {}} />)

    await user.type(screen.getByLabelText('Display name'), 'Ege Baykal')
    expect(screen.getAllByText('EB').length).toBeGreaterThan(0)
  })

  it('offers every pre-installed avatar and background', () => {
    render(<Profile onBack={() => {}} />)

    for (const avatar of AVATARS) {
      expect(screen.getByRole('radio', { name: avatar.label })).toBeInTheDocument()
    }
    for (const background of BACKGROUNDS) {
      expect(screen.getByRole('radio', { name: background.label })).toBeInTheDocument()
    }
  })

  it('changes the avatar and marks it selected', async () => {
    const user = userEvent.setup()
    render(<Profile onBack={() => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Rocket' }))

    expect(useSettings.getState().avatarId).toBe('rocket')
    expect(screen.getByRole('radio', { name: 'Rocket' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Initials' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('changes the background independently of the avatar', async () => {
    const user = userEvent.setup()
    render(<Profile onBack={() => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Rocket' }))
    await user.click(screen.getByRole('radio', { name: 'Ember' }))

    expect(useSettings.getState().avatarId).toBe('rocket')
    expect(useSettings.getState().avatarBackgroundId).toBe('ember')
  })

  it('survives a reload', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Profile onBack={() => {}} />)

    await user.type(screen.getByLabelText('Display name'), 'Ege')
    await user.click(screen.getByRole('radio', { name: 'Flame' }))
    await user.click(screen.getByRole('radio', { name: 'Gold' }))

    // zustand/persist writes to localStorage; rehydrating is what a reload does.
    unmount()
    await useSettings.persist.rehydrate()
    render(<Profile onBack={() => {}} />)

    expect(useSettings.getState().displayName).toBe('Ege')
    expect(screen.getByRole('radio', { name: 'Flame' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Gold' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('goes back', async () => {
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(<Profile onBack={onBack} />)

    await user.click(screen.getByRole('button', { name: /Back/ }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})

describe('avatar catalog', () => {
  it('resolves the store defaults to real entries', () => {
    // core/settings/store.ts hardcodes these ids to stay free of React imports,
    // so this is the guard against the two lists drifting apart.
    const { avatarId, avatarBackgroundId } = useSettings.getInitialState()

    expect(AVATARS.some((a) => a.id === avatarId)).toBe(true)
    expect(BACKGROUNDS.some((b) => b.id === avatarBackgroundId)).toBe(true)
  })

  it('falls back instead of throwing on an unknown saved id', () => {
    expect(resolveAvatar('deleted-in-a-later-version').id).toBe('initials')
    expect(resolveBackground('deleted-in-a-later-version').id).toBe('slate')
  })

  it('has unique ids and a legible ink choice for every background', () => {
    expect(new Set(AVATARS.map((a) => a.id)).size).toBe(AVATARS.length)
    expect(new Set(BACKGROUNDS.map((b) => b.id)).size).toBe(BACKGROUNDS.length)

    for (const background of BACKGROUNDS) {
      expect(background.ink).toMatch(/^(light|dark)$/)
      expect(background.from).toMatch(/^#[0-9a-f]{6}$/i)
      expect(background.to).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
