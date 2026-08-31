// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signInWithProvider } from '../core/auth'
import { useAuth } from '../core/auth/store'
import { saveStoredConfig } from '../core/sync/supabase'
import { SignIn } from './SignIn'

/*
  The redirect itself is stubbed. Leaving the page is jsdom's least favourite
  thing, and the URL it would leave for is already covered in the auth tests —
  what this screen owns is which provider it asks for, not how the URL is built.
*/
vi.mock('../core/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/auth')>()
  return { ...actual, signInWithProvider: vi.fn(() => true) }
})

const CONFIG = { url: 'https://example.supabase.co', anonKey: 'a'.repeat(40) }

/*
  The screen asks the project which providers it has switched on. Stubbed for
  every test, so none of them reaches for a network — and so the default is a
  project with everything enabled, which is what the rest of these assert.
*/
function stubSettings(external: Record<string, boolean>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ external }), { status: 200 })),
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  stubSettings({ email: true, google: true, apple: true, github: true })
  useAuth.setState({ session: null, checked: false })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('first run', () => {
  it('asks for a project instead of offering a sign-in it cannot perform', () => {
    render(<SignIn />)

    expect(screen.getByText(/connect your project first/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull()
  })

  it('will not accept a service-role-shaped paste as a project URL', async () => {
    const user = userEvent.setup()
    render(<SignIn />)

    await user.type(screen.getByLabelText(/project url/i), 'not-a-url')
    await user.type(screen.getByLabelText(/anon key/i), 'k'.repeat(40))

    expect(screen.getByRole('button', { name: /continue/i }).hasAttribute('disabled')).toBe(true)
  })

  it('opens the sign-in options once a project is saved', async () => {
    const user = userEvent.setup()
    render(<SignIn />)

    await user.type(screen.getByLabelText(/project url/i), CONFIG.url)
    await user.type(screen.getByLabelText(/anon key/i), CONFIG.anonKey)
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('button', { name: /continue with google/i })).toBeTruthy()
  })
})

describe('with a project configured', () => {
  beforeEach(() => {
    saveStoredConfig(CONFIG)
  })

  it('offers Apple alongside Google, which Apple requires', () => {
    render(<SignIn />)

    // Not decoration: shipping Google without Apple is a review rejection.
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /continue with apple/i })).toBeTruthy()
  })

  it('offers GitHub too, which is the cheapest of the three to switch on', () => {
    render(<SignIn />)

    // Free OAuth app, no cloud console project and no paid membership — often the
    // first provider that actually works on a new project.
    expect(screen.getByRole('button', { name: /continue with github/i })).toBeTruthy()
  })

  it('starts the flow for the provider that was pressed', async () => {
    const user = userEvent.setup()
    render(<SignIn />)

    await user.click(screen.getByRole('button', { name: /continue with apple/i }))

    expect(signInWithProvider).toHaveBeenCalledWith('apple')
  })

  it('keeps the submit button shut until both fields are usable', async () => {
    const user = userEvent.setup()
    render(<SignIn />)

    const submit = screen.getByRole('button', { name: /^sign in$/i })
    expect(submit.hasAttribute('disabled')).toBe(true)

    await user.type(screen.getByLabelText(/email/i), 'someone@example.com')
    await user.type(screen.getByLabelText(/password/i), '12345')
    expect(submit.hasAttribute('disabled')).toBe(true)

    await user.type(screen.getByLabelText(/password/i), '6')
    expect(submit.hasAttribute('disabled')).toBe(false)
  })

  it('switches to registration without leaving the screen', async () => {
    const user = userEvent.setup()
    render(<SignIn />)

    await user.click(screen.getByRole('button', { name: /create one/i }))

    expect(screen.getByRole('heading', { name: /create your account/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^create account$/i })).toBeTruthy()
  })

  it('shows what came back from a refused provider sign-in', () => {
    render(<SignIn notice="Sign-in was cancelled." />)

    expect(screen.getByRole('status').textContent).toBe('Sign-in was cancelled.')
  })

  it('withdraws the buttons the project cannot honour', async () => {
    // The bug this exists for: pressing Google on a project where Google is off
    // is a full-page redirect that lands on
    // `{"code":400,…,"msg":"Unsupported provider: provider is not enabled"}` —
    // raw JSON, with nothing of the app still running to explain it.
    stubSettings({ email: true, google: false, apple: false, github: true })
    render(<SignIn />)

    expect(await screen.findByRole('button', { name: /continue with github/i })).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull()
    })
    expect(screen.queryByRole('button', { name: /continue with apple/i })).toBeNull()
  })

  it('says where the withdrawn ones are switched on', async () => {
    stubSettings({ email: true, google: false, apple: false, github: true })
    render(<SignIn />)

    // A missing button is a mystery; the sentence is what turns it into a task.
    const note = await screen.findByText(/google and apple are switched off/i)
    expect(note.textContent).toMatch(/authentication/i)
  })

  it('offers everything when the project cannot be asked', async () => {
    // Failing open on purpose: a probe that failed must never be the reason
    // somebody cannot sign in.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    render(<SignIn />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with google/i })).toBeTruthy()
    })
    expect(screen.queryByText(/switched off/i)).toBeNull()
  })

  it('reports a sign-up that still needs its email confirmed', async () => {
    const user = userEvent.setup()
    useAuth.setState({
      signUp: async () => ({ ok: true, message: 'Check your email to confirm the account.' }),
    })
    render(<SignIn />)

    await user.click(screen.getByRole('button', { name: /create one/i }))
    await user.type(screen.getByLabelText(/email/i), 'someone@example.com')
    await user.type(screen.getByLabelText(/password/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /^create account$/i }))

    expect((await screen.findByRole('status')).textContent).toMatch(/confirm/i)
  })
})
