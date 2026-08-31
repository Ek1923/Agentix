import { describeStatus, ProviderError, type Provider } from './types'

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

interface MessagesResponse {
  content?: Array<{ type: string; text?: string }>
}

export const anthropic: Provider = {
  id: 'anthropic',
  label: 'Anthropic',
  models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  consoleUrl: 'https://console.anthropic.com/settings/keys',

  async complete(key, model, prompt) {
    let res: Response
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': API_VERSION,
          // Required for calls made straight from a browser. Agentix is
          // device-only by design, so there is no server to proxy through.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
    } catch {
      // Deliberately not forwarding the caught error: fetch failures can carry
      // request details, and request details include the key.
      throw new ProviderError('Could not reach Anthropic. Check your connection.')
    }

    if (!res.ok) throw new ProviderError(describeStatus(res.status, 'Anthropic'), res.status)

    const data = (await res.json()) as MessagesResponse
    const text = data.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')

    if (!text) throw new ProviderError('Anthropic returned an empty response.')
    return text
  },
}
