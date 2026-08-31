import { useCallback, useEffect, useSyncExternalStore } from 'react'

/**
 * Routing over the browser's history stack.
 *
 * The app kept its route in React state until the Android port needed a back
 * button. A WebView hands the hardware back button to `history.back()`, so a route
 * that is not in history means Android's back button closes the app from any
 * screen — the single most jarring thing a ported web app can do.
 *
 * Putting it in history fixes that and gives the web build browser back and
 * forward for free. It is one API doing both jobs rather than two mechanisms
 * that can disagree.
 */

export type Route =
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'profile' }
  | { name: 'theme' }
  | { name: 'organization' }
  | { name: 'signin' }
  | { name: 'plugin'; id: string }

const SHELL_ROUTES = ['home', 'settings', 'profile', 'theme', 'organization', 'signin'] as const

/**
 * A route as a hash, so the app works from `file://` and from a static host with
 * no server rewrite rules — which is what GitHub Pages and a Capacitor WebView
 * both are.
 */
export function toHash(route: Route): string {
  return route.name === 'plugin' ? `#/plugin/${route.id}` : `#/${route.name}`
}

export function fromHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  if (path === '') return { name: 'home' }

  const [head, ...rest] = path.split('/')
  if (head === 'plugin') {
    const id = rest.join('/')
    return id === '' ? { name: 'home' } : { name: 'plugin', id }
  }

  const shell = SHELL_ROUTES.find((name) => name === head)
  // An unknown hash lands on home rather than a blank screen.
  return shell === undefined ? { name: 'home' } : { name: shell }
}

/** Where a given screen goes "back" to. Every route reaches home in one step. */
export function parentOf(route: Route): Route {
  return route.name === 'home' ? { name: 'home' } : { name: 'home' }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    window.removeEventListener('hashchange', onChange)
    window.removeEventListener('popstate', onChange)
  }
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

export interface Router {
  route: Route
  /** Pushes a new entry, so back returns to where you were. */
  navigate: (to: string) => void
  /** Steps back through history, exactly as the hardware button does. */
  back: () => void
}

export function useRouter(): Router {
  const hash = useSyncExternalStore(subscribe, currentHash, () => '')
  const route = fromHash(hash)

  const navigate = useCallback((to: string) => {
    const next: Route = SHELL_ROUTES.some((name) => name === to)
      ? ({ name: to } as Route)
      : { name: 'plugin', id: to }

    const target = toHash(next)
    // Navigating to where you already are must not stack a duplicate entry, or
    // back appears to do nothing.
    if (window.location.hash === target) return
    window.location.hash = target
  }, [])

  const back = useCallback(() => {
    window.history.back()
  }, [])

  // A first load with no hash gets one, so the first navigation has somewhere to
  // come back to instead of leaving the app.
  useEffect(() => {
    if (window.location.hash === '') {
      window.history.replaceState(null, '', `${window.location.pathname}#/home`)
    }
  }, [])

  return { route, navigate, back }
}
