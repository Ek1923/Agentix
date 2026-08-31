import { realmUrl, type IdentityConfig } from './identity'
import type { SupabaseConfig } from './supabase'

/**
 * Is the project reachable, and how fast?
 *
 * The point is a light so you can tell "sync is broken" from "the server is
 * down" without opening a dashboard, and the whole design follows from wanting
 * that answer without paying for it in traffic.
 *
 * **What it sends.** One `GET` to `/auth/v1/health`, which is GoTrue's own
 * liveness endpoint. The reply is roughly a hundred bytes of JSON — a name and a
 * version — and it touches no table, so it costs nothing on the database and
 * cannot return anybody's data. It is chosen over `/rest/v1/`, which answers with
 * the full OpenAPI schema and would be tens of kilobytes per ping.
 *
 * **How often.** Once a minute while the app is in front of you, and not at all
 * when it is not — a backgrounded tab polling a server all night is the thing
 * this is trying not to be. On failure it backs off, so a project that is down
 * costs less to watch than one that is up.
 */

export type HealthStatus =
  /** Answered, and the key was accepted. */
  | 'online'
  /** Answered, but refused the anon key — the project is up and misconfigured. */
  | 'unauthorized'
  /** No answer: down, offline, or a URL that points nowhere. */
  | 'offline'
  /** Never asked, because there is nothing to ask. */
  | 'unknown'

export interface HealthResult {
  status: HealthStatus
  /** Round trip in milliseconds, when there was one. */
  latencyMs: number | null
  /** ISO timestamp of the attempt. */
  at: string
  /** One short sentence, safe to render. Never carries the key or the response. */
  message: string
}

export const HEALTH_PATH = '/auth/v1/health'

/** Base interval while everything is fine. */
export const HEALTHY_INTERVAL_MS = 60_000
/** Never poll faster than this, whatever the caller asks. */
export const MIN_INTERVAL_MS = 15_000
/** However bad it gets, keep one slow heartbeat rather than giving up. */
export const MAX_INTERVAL_MS = 10 * 60_000

/**
 * How long to wait before the next attempt.
 *
 * Doubling on consecutive failures, because a project that has been down for an
 * hour is not going to be fixed by asking more often, and the cost of noticing a
 * minute late is nothing. Recovery is immediate: one success resets it, so a
 * project that comes back is seen on the next tick rather than ten minutes on.
 */
export function nextDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return HEALTHY_INTERVAL_MS
  const backed = HEALTHY_INTERVAL_MS * 2 ** Math.min(consecutiveFailures, 6)
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, backed))
}

/** Whether a result should count against the failure streak. */
export function isFailure(status: HealthStatus): boolean {
  return status === 'offline'
}

/** Latency worth calling out. Below this the number is noise, not information. */
export const SLOW_MS = 1200

export function describeHealth(result: HealthResult): string {
  switch (result.status) {
    case 'online':
      return result.latencyMs !== null && result.latencyMs >= SLOW_MS
        ? `Reachable, but slow — ${result.latencyMs} ms`
        : `Reachable${result.latencyMs === null ? '' : ` — ${result.latencyMs} ms`}`
    case 'unauthorized':
      return 'The project answered but refused the key. Check the anon key.'
    case 'offline':
      return 'No answer. The project may be paused, or this device is offline.'
    case 'unknown':
      return 'Not checked yet.'
  }
}

/**
 * One heartbeat.
 *
 * `fetchImpl` is injectable so the tests can drive every branch without a
 * network, the same way the transport and auth are tested.
 *
 * Never throws, and never forwards the caught error: a failed request can carry
 * the URL and headers, and the headers carry the key.
 */
export async function checkHealth(
  config: SupabaseConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<HealthResult> {
  const at = new Date().toISOString()
  const started = Date.now()

  // Without a timeout a hung connection holds the interval open and the next tick
  // stacks on top of it. AbortSignal.timeout is not in every WebView, so the
  // controller is built by hand.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(`${config.url}${HEALTH_PATH}`, {
      method: 'GET',
      headers: { apikey: config.anonKey },
      signal: controller.signal,
      // The answer is a version string; a cached one would report a project that
      // has since gone down as healthy.
      cache: 'no-store',
    })

    const latencyMs = Date.now() - started

    if (response.status === 401 || response.status === 403) {
      const result: HealthResult = { status: 'unauthorized', latencyMs, at, message: '' }
      return { ...result, message: describeHealth(result) }
    }
    if (!response.ok) {
      const result: HealthResult = { status: 'offline', latencyMs, at, message: '' }
      return { ...result, message: describeHealth(result) }
    }

    const result: HealthResult = { status: 'online', latencyMs, at, message: '' }
    return { ...result, message: describeHealth(result) }
  } catch {
    const result: HealthResult = {
      status: 'offline',
      latencyMs: null,
      at,
      message: '',
    }
    return { ...result, message: describeHealth(result) }
  } finally {
    clearTimeout(timer)
  }
}

/* ── The organisation's own server ──────────────────────────────────────────── */

/**
 * The realm's discovery document — small, public, and cached by nobody here.
 *
 * A better liveness probe than any endpoint of ours would be, because answering
 * it at all proves the whole chain: the tunnel is up, the container is running,
 * and the realm exists. A 404 here is the single most common way a fresh box is
 * wrong — the realm was never created — and it is worth telling apart from silence.
 */
export const REALM_DISCOVERY_PATH = '/.well-known/openid-configuration'

function describeIdentityHealth(result: HealthResult): string {
  switch (result.status) {
    case 'online':
      return result.latencyMs !== null && result.latencyMs >= SLOW_MS
        ? `Answering, but slow — ${result.latencyMs} ms`
        : `Answering${result.latencyMs === null ? '' : ` — ${result.latencyMs} ms`}`
    case 'unauthorized':
      // Reachable, but not the realm the app expects. Usually a realm that was
      // never created, or created under another name.
      return 'The server answered, but there is no agentix realm on it.'
    case 'offline':
      return 'No answer. The server may be down, or the tunnel is not up.'
    case 'unknown':
      return 'Not checked yet.'
  }
}

/**
 * One heartbeat against the organisation's server.
 *
 * Nothing is sent with it: the discovery document is public by design, so this
 * needs no token and can be run before anybody has signed in — which is exactly
 * when you want it, standing a new box up.
 */
export async function checkIdentityHealth(
  config: IdentityConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<HealthResult> {
  const at = new Date().toISOString()
  const started = Date.now()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(`${realmUrl(config)}${REALM_DISCOVERY_PATH}`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })

    const latencyMs = Date.now() - started
    const status: HealthStatus =
      response.status === 404 ? 'unauthorized' : response.ok ? 'online' : 'offline'

    const result: HealthResult = { status, latencyMs, at, message: '' }
    return { ...result, message: describeIdentityHealth(result) }
  } catch {
    // The error is dropped, as everywhere else: it can carry the request.
    const result: HealthResult = { status: 'offline', latencyMs: null, at, message: '' }
    return { ...result, message: describeIdentityHealth(result) }
  } finally {
    clearTimeout(timer)
  }
}

export const UNKNOWN_HEALTH: HealthResult = {
  status: 'unknown',
  latencyMs: null,
  at: '',
  message: describeHealth({ status: 'unknown', latencyMs: null, at: '', message: '' }),
}
