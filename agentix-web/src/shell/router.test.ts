// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fromHash, parentOf, toHash, type Route } from './router'

describe('toHash', () => {
  it('writes a shell route', () => {
    expect(toHash({ name: 'home' })).toBe('#/home')
    expect(toHash({ name: 'settings' })).toBe('#/settings')
  })

  it('writes a plugin route with its id', () => {
    expect(toHash({ name: 'plugin', id: 'task-manager' })).toBe('#/plugin/task-manager')
  })
})

describe('fromHash', () => {
  it('reads back everything toHash writes', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'settings' },
      { name: 'profile' },
      { name: 'theme' },
      { name: 'plugin', id: 'backtest' },
    ]
    for (const route of routes) {
      expect(fromHash(toHash(route))).toEqual(route)
    }
  })

  it('treats an empty hash as home', () => {
    expect(fromHash('')).toEqual({ name: 'home' })
    expect(fromHash('#')).toEqual({ name: 'home' })
    expect(fromHash('#/')).toEqual({ name: 'home' })
  })

  it('lands an unknown route on home rather than a blank screen', () => {
    expect(fromHash('#/nonsense')).toEqual({ name: 'home' })
    expect(fromHash('#/plugin')).toEqual({ name: 'home' })
    expect(fromHash('#/plugin/')).toEqual({ name: 'home' })
  })

  it('tolerates a missing leading slash', () => {
    expect(fromHash('#settings')).toEqual({ name: 'settings' })
  })

  it('keeps a plugin id containing a slash intact', () => {
    expect(fromHash('#/plugin/scoped/name')).toEqual({ name: 'plugin', id: 'scoped/name' })
  })
})

describe('parentOf', () => {
  it('takes every screen back to home in one step', () => {
    expect(parentOf({ name: 'settings' })).toEqual({ name: 'home' })
    expect(parentOf({ name: 'plugin', id: 'agenda' })).toEqual({ name: 'home' })
    expect(parentOf({ name: 'home' })).toEqual({ name: 'home' })
  })
})

describe('why the hash, and not a path', () => {
  it('produces a location that works without server rewrites', () => {
    // A path route needs the host to rewrite unknown paths to index.html. A
    // Capacitor WebView and a static GitHub Pages site both do not.
    for (const route of [{ name: 'settings' } as Route, { name: 'plugin', id: 'flow' } as Route]) {
      expect(toHash(route).startsWith('#/')).toBe(true)
    }
  })
})
