import { describeStatus, ProviderError, type Provider } from './types'

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export const openai: Provider = {
  id: 'openai',
  label: 'OpenAI',
  models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
  keyPattern: /^sk-[A-Za-z0-9_-]{20,}$/,
  consoleUrl: 'https://platform.openai.com/api-keys',

  async complete(key, model, prompt) {
    let res: Response
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
    } catch {
      // See anthropic.ts — the caught error is dropped because it can carry the key.
      throw new ProviderError('Could not reach OpenAI. Check your connection.')
    }

    if (!res.ok) throw new ProviderError(describeStatus(res.status, 'OpenAI'), res.status)

    const data = (await res.json()) as ChatResponse
    const text = data.choices?.[0]?.message?.content

    if (!text) throw new ProviderError('OpenAI returned an empty response.')
    return text
  },
}
