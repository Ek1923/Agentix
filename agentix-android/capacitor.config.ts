import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The Android shell around the web build.
 *
 * Capacitor rather than React Native, deliberately. The brief says Android is
 * "ported from web", and this is the only reading under which that is literally
 * true: the same TSX, the same Dexie over IndexedDB, the same Tailwind and the
 * same Framer Motion run unchanged inside a WebView. React Native would mean
 * rewriting all forty components against a different rendering model — and a
 * rewrite is exactly what the iOS Swift build already is. Two rewrites for three
 * platforms is one too many.
 */
const config: CapacitorConfig = {
  appId: 'com.egebaykal.agentix',
  appName: 'Agentix',

  // Points at the web build rather than a copy. There is one source of truth for
  // the app, and `npm run sync` rebuilds it before every native sync.
  webDir: '../agentix-web/dist',

  android: {
    // https rather than the default http scheme: IndexedDB and localStorage are
    // partitioned by origin, and an insecure origin gets a different, weaker one.
    // The whole app is offline-first storage, so this is not cosmetic.
    allowMixedContent: false,
  },

  server: {
    androidScheme: 'https',
  },

  plugins: {
    // Nothing is bundled beyond the core. The one native capability the app uses
    // — haptics — already works through the Vibration API in an Android WebView,
    // so `ui/feedback.ts` needs no Android-specific branch.
  },
}

export default config
