// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readIdentityConfig, saveIdentityUrl } from '../../core/sync/identity'
import { OrganizationServer } from './OrganizationServer'

const field = () => screen.getByLabelText(/address/i)

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('pointing this device at the organisation', () => {
  it('starts empty, and says what that means', () => {
    render(<OrganizationServer />)

    expect(screen.getByText(/this device is the personal app/i)).toBeInTheDocument()
    expect(field()).toHaveValue('')
  })

  it('remembers an address that was saved', async () => {
    const user = userEvent.setup()
    render(<OrganizationServer />)

    await user.type(field(), 'https://id.example.com')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(readIdentityConfig()).toEqual({ url: 'https://id.example.com' })
    expect(screen.getByText('https://id.example.com')).toBeInTheDocument()
  })

  it('refuses plain http instead of quietly keeping it', async () => {
    const user = userEvent.setup()
    render(<OrganizationServer />)

    await user.type(field(), 'http://id.example.com')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(readIdentityConfig()).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/https/i)
  })

  it('forgets on request, and the app is the personal one again', async () => {
    const user = userEvent.setup()
    saveIdentityUrl('https://id.example.com')
    render(<OrganizationServer />)

    await user.click(screen.getByRole('button', { name: /forget/i }))

    expect(readIdentityConfig()).toBeNull()
    expect(screen.getByText(/personal app/i)).toBeInTheDocument()
  })
})

describe('checking whether it answers', () => {
  it('reads the realm discovery document, which needs nobody to be signed in', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    saveIdentityUrl('https://id.example.com')

    render(<OrganizationServer />)
    await user.click(screen.getByRole('button', { name: /check now/i }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/answering/i))
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://id.example.com/realms/agentix/.well-known/openid-configuration',
    )
    // Public by design — a probe that needed a token could not be run while
    // standing the box up, which is exactly when it is wanted.
    expect(fetchMock.mock.calls[0]![1]?.headers).toBeUndefined()
  })

  it('tells a missing realm apart from a server that is simply down', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    saveIdentityUrl('https://id.example.com')

    render(<OrganizationServer />)
    await user.click(screen.getByRole('button', { name: /check now/i }))

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/no agentix realm/i),
    )
  })

  it('says no answer when nothing is there', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    saveIdentityUrl('https://id.example.com')

    render(<OrganizationServer />)
    await user.click(screen.getByRole('button', { name: /check now/i }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/no answer/i))
  })

  it('cannot be checked before there is something to check', () => {
    render(<OrganizationServer />)

    expect(screen.getByRole('button', { name: /check now/i })).toBeDisabled()
  })
})
