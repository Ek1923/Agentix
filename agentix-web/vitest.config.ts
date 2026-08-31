import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    // Default is node; component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock, so logic tests stay fast.
    environment: 'node',
    // fake-indexeddb/auto installs a real IndexedDB implementation onto globalThis,
    // so Dexie runs unmodified and the tests exercise the same code path the
    // browser does — including transactions and index behaviour.
    setupFiles: ['fake-indexeddb/auto', './src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
    /*
      Three times the default, for the machine rather than for the code.

      Nothing here takes seconds; the slowest case is a component waiting on a
      layout animation and a Dexie transaction. But sixty files run in parallel,
      and on a two-core CI runner that queue is long enough to push a 20ms
      assertion past a 5s ceiling — which fails a deploy for a reason that has
      nothing to do with the change being deployed. This raises the ceiling, not
      the floor: a fast test is still fast, only the point at which waiting is
      called a failure moves.
    */
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
