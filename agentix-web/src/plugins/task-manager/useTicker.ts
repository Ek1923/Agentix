import { useEffect, useState } from 'react'

/**
 * Returns the current time as an ISO string, re-rendering on an interval so a
 * running clock advances.
 *
 * The interval only forces a re-render; the timestamp itself is read fresh each
 * render. That means the value can never be stale — a tab restored from the
 * background shows the right time on its first frame rather than catching up a
 * second later.
 *
 * Pass `active: false` when nothing is running, so an idle screen does not wake
 * up once a second for no reason.
 */
export function useTicker(active: boolean, intervalMs = 1000): string {
  const [, forceRender] = useState(0)

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => forceRender((n) => n + 1), intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs])

  return new Date().toISOString()
}
