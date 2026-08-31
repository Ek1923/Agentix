import type { SupabaseConfig } from '../sync/supabase'
import { OAUTH_PROVIDERS, type OAuthProvider } from './index'

/**
 * Which ways in the project actually has switched on.
 *
 * The gate used to offer all three identity providers unconditionally, and a
 * project with only email configured answered the Google button with a raw
 * `{"code":400,…,"msg":"Unsupported provider: provider is not enabled"}` page.
 * That is a dead end in the worst place: it is a full-page redirect, so there is
 * nothing left running to catch it, and the person is looking at JSON rather than
 * at the app.
 *
 * So ask first. GoTrue publishes its own configuration at `/auth/v1/settings` —
 * the same endpoint the official client reads — and the answer says exactly which
 * externals are on. A button that cannot work is not drawn, and the ones that are
 * missing get a sentence saying where to switch them on.
 *
 * **Failing open is deliberate.** If the project cannot be asked — offline, a
 * paused project, an older self-hosted GoTrue without the endpoint — every button
 * is shown. A probe that fails must never be the reason somebody cannot sign in;
 * the worst case then is the error page they get today.
 */

export interface EnabledProviders {
  /** OAuth providers to offer, in the app's own order. */
  oauth: OAuthProvider[]
  /** Email and password, which GoTrue lists as an external like any other. */
  email: boolean
  /**
   * Whether the project actually answered.
   *
   * False means everything above is an assumption, so nothing may be hidden and
   * nothing may be claimed on screen about what is switched off.
   */
  known: boolean
}

export const SETTINGS_PATH = '/auth/v1/settings'

/** What is offered when the project could not be asked: all of it. */
export const ASSUME_ALL: EnabledProviders = {
  oauth: OAUTH_PROVIDERS.map((p) => p.id),
  email: true,
  known: false,
}

/**
 * Reads GoTrue's settings payload.
 *
 * The shape is `{ external: { google: true, apple: false, … } }`. Only the three
 * keys this app has buttons for are read: the endpoint lists every provider
 * GoTrue supports, and most of them are not offers Agentix makes.
 *
 * A missing or malformed `external` is treated as "did not answer" rather than as
 * "nothing is enabled" — the difference decides whether the screen hides buttons,
 * and hiding them all on a shape change would lock somebody out of a project that
 * is working fine.
 */
export function parseEnabledProviders(payload: unknown): EnabledProviders {
  if (typeof payload !== 'object' || payload === null) return ASSUME_ALL

  const external = (payload as { external?: unknown }).external
  if (typeof external !== 'object' || external === null) return ASSUME_ALL

  const flags = external as Record<string, unknown>
  return {
    oauth: OAUTH_PROVIDERS.map((p) => p.id).filter((id) => flags[id] === true),
    // Absent rather than false means an older GoTrue that does not list it; email
    // is the one route that exists in every project, so absence is not "off".
    email: flags.email !== false,
    known: true,
  }
}

/**
 * Asks the project what it offers.
 *
 * Never throws and never forwards the caught error, for the same reason the
 * heartbeat does not: a failed request carries its headers, and the headers carry
 * the key. Every failure returns `ASSUME_ALL`, which is the safe direction.
 */
export async function fetchEnabledProviders(
  config: SupabaseConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 6000,
): Promise<EnabledProviders> {
  // AbortSignal.timeout is missing from some WebViews this ships in, so the
  // controller is built by hand — the same compromise the heartbeat makes.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(`${config.url}${SETTINGS_PATH}`, {
      method: 'GET',
      headers: { apikey: config.anonKey },
      signal: controller.signal,
      // A project whose providers were just turned on must not be reported from
      // a cache written before the change.
      cache: 'no-store',
    })
    if (!response.ok) return ASSUME_ALL
    return parseEnabledProviders(await response.json())
  } catch {
    return ASSUME_ALL
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The line shown under the buttons when some providers are off.
 *
 * Null when there is nothing to say — everything is on, or the project never
 * answered and the app is in no position to make a claim about it.
 */
export function describeMissingProviders(enabled: EnabledProviders): string | null {
  if (!enabled.known) return null

  const missing = OAUTH_PROVIDERS.filter((p) => !enabled.oauth.includes(p.id)).map((p) => p.label)
  if (missing.length === 0) return null

  const names =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
  const verb = missing.length === 1 ? 'is' : 'are'

  return `${names} ${verb} switched off in this project. Turn them on under Authentication → Providers in Supabase.`
}
