import { anthropic } from './providers/anthropic'
import { openai } from './providers/openai'
import { ProviderError, type Provider, type ProviderId } from './providers/types'
import { getKey } from './secure-store'

export const providers: Record<ProviderId, Provider> = {
  anthropic,
  openai,
}

export const providerList: Provider[] = [anthropic, openai]

export function getProvider(id: ProviderId): Provider {
  return providers[id]
}

export interface TestResult {
  ok: boolean
  message: string
}

export interface AIService {
  complete(prompt: string): Promise<string>
  /** True when the active provider has a key, so plugins can show an empty state. */
  isConfigured(): Promise<boolean>
}

/**
 * Resolves which provider and model are active. The settings store owns this value;
 * it is injected rather than imported so `core/ai` stays free of UI dependencies.
 */
export interface ActiveConfig {
  providerId: ProviderId
  model: string
}

/**
 * The only entry point plugins use to reach a model. Plugins never see the key,
 * never choose a provider, and never call a provider URL — so moving to a server
 * proxy later changes this file and nothing else.
 */
export function createAIService(getActive: () => ActiveConfig): AIService {
  return {
    async complete(prompt) {
      const { providerId, model } = getActive()
      const key = await getKey(providerId)
      if (!key) {
        throw new ProviderError(
          `No API key set for ${providers[providerId].label}. Add one in Settings → API Keys.`,
        )
      }
      return providers[providerId].complete(key, model, prompt)
    },

    async isConfigured() {
      const key = await getKey(getActive().providerId)
      return key !== null && key.length > 0
    },
  }
}

/**
 * Fires one minimal request to prove a key works. Used by the Test connection
 * button, where a bad key must be distinguishable from a broken plugin.
 */
export async function testConnection(
  providerId: ProviderId,
  model: string,
  key: string,
): Promise<TestResult> {
  const provider = providers[providerId]

  if (!provider.keyPattern.test(key)) {
    return { ok: false, message: `That does not look like a ${provider.label} key.` }
  }

  try {
    await provider.complete(key, model, 'Reply with the single word: ok')
    return { ok: true, message: `${provider.label} key works.` }
  } catch (err) {
    // ProviderError messages are written to be safe to display. Anything else is
    // replaced rather than surfaced, because an unknown error may quote the request.
    const message =
      err instanceof ProviderError ? err.message : 'Test failed for an unknown reason.'
    return { ok: false, message }
  }
}

export { ProviderError }
export type { Provider, ProviderId }
