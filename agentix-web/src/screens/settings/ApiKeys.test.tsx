// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteKey, getKey, setKey } from '../../core/ai/secure-store'
import { useSettings } from '../../core/settings/store'
import { ApiKeys } from './ApiKeys'

// Key-shaped but self-identifying — see the note in core/ai/ai.test.ts.
const ANTHROPIC_KEY = 'sk-ant-api03-FAKEKEYFORTESTS0001'
const OPENAI_KEY = 'sk-proj-FAKEKEYFORTESTS0002'
const ANTHROPIC_MASK = /••••••••0001/
const OPENAI_MASK = /••••••••0002/

/** One OK response, matching whichever provider is asked. */
function stubOkFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'ok' }],
            choices: [{ message: { content: 'ok' } }],
          }),
          { status: 200 },
        ),
    ),
  )
}

beforeEach(async () => {
  await deleteKey('anthropic')
  await deleteKey('openai')
  useSettings.setState({ activeProvider: 'anthropic' })
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('API keys screen', () => {
  it('saves a key and it survives a reload', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<ApiKeys />)

    await user.type(screen.getByLabelText('Anthropic key'), ANTHROPIC_KEY)
    await user.click(screen.getByRole('button', { name: 'Save key' }))

    expect(await screen.findByText(/Key saved on this device/)).toBeInTheDocument()
    expect(await getKey('anthropic')).toBe(ANTHROPIC_KEY)

    // A reload is a fresh mount reading storage again — nothing survives in memory.
    unmount()
    render(<ApiKeys />)

    expect(await screen.findByText(ANTHROPIC_MASK)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeInTheDocument()
  })

  it('never renders the key itself, only a masked tail', async () => {
    await setKey('anthropic', ANTHROPIC_KEY)
    render(<ApiKeys />)

    await screen.findByText(ANTHROPIC_MASK)
    expect(document.body.textContent).not.toContain(ANTHROPIC_KEY)

    // The input is masked and starts empty rather than pre-filled with the secret.
    const input = screen.getByLabelText('Anthropic key') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.value).toBe('')
  })

  it('keeps each provider key separate when the dropdown switches', async () => {
    const user = userEvent.setup()
    await setKey('anthropic', ANTHROPIC_KEY)
    await setKey('openai', OPENAI_KEY)

    render(<ApiKeys />)
    expect(await screen.findByText(ANTHROPIC_MASK)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Provider'), 'openai')

    expect(await screen.findByText(OPENAI_MASK)).toBeInTheDocument()
    expect(screen.queryByText(ANTHROPIC_MASK)).not.toBeInTheDocument()
    expect(screen.getByLabelText('OpenAI key')).toBeInTheDocument()
  })

  it('does not carry a typed key across a provider switch', async () => {
    const user = userEvent.setup()
    render(<ApiKeys />)

    await user.type(screen.getByLabelText('Anthropic key'), ANTHROPIC_KEY)
    await user.selectOptions(screen.getByLabelText('Provider'), 'openai')

    expect((screen.getByLabelText('OpenAI key') as HTMLInputElement).value).toBe('')

    // And nothing was written to the provider that was never saved to.
    expect(await getKey('anthropic')).toBeNull()
    expect(await getKey('openai')).toBeNull()
  })

  it('rejects a key that does not match the provider format, without saving', async () => {
    const user = userEvent.setup()
    render(<ApiKeys />)

    await user.type(screen.getByLabelText('Anthropic key'), 'definitely-not-a-key')
    await user.click(screen.getByRole('button', { name: 'Save key' }))

    expect(await screen.findByText(/does not look like an? Anthropic key/i)).toBeInTheDocument()
    expect(await getKey('anthropic')).toBeNull()
  })

  it('reports success from Test connection on a working key', async () => {
    const user = userEvent.setup()
    stubOkFetch()
    await setKey('anthropic', ANTHROPIC_KEY)

    render(<ApiKeys />)
    // The buttons stay disabled until the stored key has loaded, so wait for the
    // saved indicator rather than clicking into a disabled control.
    await screen.findByText(ANTHROPIC_MASK)
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('Anthropic key works.')).toBeInTheDocument()
  })

  it('reports failure from Test connection on a rejected key', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await setKey('anthropic', ANTHROPIC_KEY)

    render(<ApiKeys />)
    await screen.findByText(ANTHROPIC_MASK)
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/Key rejected/)).toBeInTheDocument()
  })

  it('deletes a key out of storage', async () => {
    const user = userEvent.setup()
    await setKey('anthropic', ANTHROPIC_KEY)

    render(<ApiKeys />)
    await screen.findByText(ANTHROPIC_MASK)
    await user.click(screen.getByRole('button', { name: 'Delete key' }))

    expect(await screen.findByText(/Anthropic key deleted/)).toBeInTheDocument()
    expect(await getKey('anthropic')).toBeNull()
    expect(screen.queryByText(ANTHROPIC_MASK)).not.toBeInTheDocument()
  })

  it('offers no test or delete before a key exists', () => {
    render(<ApiKeys />)

    expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete key' })).toBeDisabled()
  })

  it('states plainly where the key is stored', () => {
    render(<ApiKeys />)
    expect(screen.getByText(/IndexedDB/)).toBeInTheDocument()
  })
})
