import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/dom'

/*
  Give `findBy` and `waitFor` room to breathe.

  The default window is one second, which is generous for one file and not enough
  for forty-five running in parallel: a card that has to finish a layout animation
  before its button reappears can miss that window on a loaded machine and hit it
  easily on an idle one. That produced failures that moved from test to test
  between runs, which is worse than a slow suite — a flake teaches people to
  re-run rather than to read.

  This raises the ceiling, not the floor. A test that resolves in 20ms still
  resolves in 20ms; only the point at which waiting is declared a failure moves.
*/
configure({ asyncUtilTimeout: 5000 })

// jsdom has no crypto.randomUUID and no matchMedia. Both are used on ordinary
// render paths, so component tests need them present before anything mounts.
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true })
}

if (typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () =>
      '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (
          Number(c) ^
          (Math.random() * 16) >> (Number(c) / 4)
        ).toString(16),
      ),
    configurable: true,
  })
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
