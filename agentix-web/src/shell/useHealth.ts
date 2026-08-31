import { useEffect, useRef, useState } from 'react'
import {
  UNKNOWN_HEALTH,
  checkHealth,
  isFailure,
  nextDelayMs,
  type HealthResult,
} from '../core/sync/health'
import type { SupabaseConfig } from '../core/sync/supabase'

/**
 * A light that says whether the project is up.
 *
 * The scheduling rules live here and the measurement lives in `core/sync/health`,
 * for the usual reason: the second is a pure function this codebase can test and
 * Swift can translate, and the first is a browser concern about tabs and timers.
 *
 * Three rules keep the traffic honest:
 *
 * 1. **Nothing without a project.** No config, no requests at all.
 * 2. **Nothing in a background tab.** A minimised window polling all night is
 *    exactly what this is trying not to be. It checks once on return, because a
 *    stale reading is worse than none.
 * 3. **Back off while it is down.** A project that has been down an hour will not
 *    be fixed by asking more often.
 */
export function useHealth(config: SupabaseConfig | null): {
  health: HealthResult
  /** Force a check now — for a "check now" button. */
  check: () => void
  checking: boolean
} {
  const [health, setHealth] = useState<HealthResult>(UNKNOWN_HEALTH)
  const [checking, setChecking] = useState(false)

  const failures = useRef(0)
  /*
    The running loop publishes its own trigger here.

    The alternative — a ref mirroring `config`, written during render — is a read
    and a write of the same value in the render pass, which React rightly warns
    about. This way the effect owns the config it was started with, and the button
    calls into that effect rather than reconstructing what it should target.
  */
  const trigger = useRef<(() => void) | null>(null)

  const url = config?.url ?? null
  const anonKey = config?.anonKey ?? null
  const configured = url !== null && anonKey !== null

  useEffect(() => {
    if (url === null || anonKey === null) {
      failures.current = 0
      trigger.current = null
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    failures.current = 0

    const stop = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }

    const once = async () => {
      if (cancelled) return
      setChecking(true)
      try {
        const result = await checkHealth({ url, anonKey })
        if (cancelled) return
        setHealth(result)
        failures.current = isFailure(result.status) ? failures.current + 1 : 0
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    const loop = async () => {
      if (cancelled || document.visibilityState !== 'visible') return
      await once()
      if (cancelled) return
      stop()
      timer = setTimeout(() => void loop(), nextDelayMs(failures.current))
    }

    trigger.current = () => void once()

    const onVisibility = () => {
      // Coming back is exactly when the reading is most likely stale.
      if (document.visibilityState === 'visible') void loop()
      else stop()
    }

    void loop()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      stop()
      trigger.current = null
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [url, anonKey])

  return {
    // Derived rather than stored: with no project there is nothing to report, and
    // writing that into state from an effect would be a render to say nothing.
    health: configured ? health : UNKNOWN_HEALTH,
    check: () => trigger.current?.(),
    checking: configured && checking,
  }
}
