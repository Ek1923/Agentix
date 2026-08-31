export type ProviderId = 'anthropic' | 'openai'

export interface Provider {
  id: ProviderId
  label: string
  models: string[]
  keyPattern: RegExp        // catch typos before spending a request
  /** Where the user gets a key. Shown as a link on the API settings page. */
  consoleUrl: string
  complete(key: string, model: string, prompt: string): Promise<string>
}

/**
 * Thrown by provider adapters. Carries a message safe to render in the UI.
 *
 * Adapters must never put the key, or a response body that could echo it, into
 * `message`. Anything shown to the user or logged passes through here.
 */
export class ProviderError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

/** Maps an HTTP status to wording that tells the user what to actually do. */
export function describeStatus(status: number, providerLabel: string): string {
  if (status === 401 || status === 403) return 'Key rejected. Check it and try again.'
  if (status === 404) return 'Model not found for this key.'
  if (status === 429) return 'Rate limited. The key works — try again shortly.'
  if (status >= 500) return `${providerLabel} is having trouble. Not your key.`
  return `Request failed (HTTP ${status}).`
}
