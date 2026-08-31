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
  },
})
