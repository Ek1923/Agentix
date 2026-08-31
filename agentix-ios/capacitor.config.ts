import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The iOS shell around the web build.
 *
 * This is the route to TestFlight, not the end state. The brief locks iOS to a
 * Swift rewrite, and that is still the right destination — but a rewrite is weeks
 * of work to learn what a day of real testers would tell you. Shipping the app
 * that exists first means the Swift build later answers a question rather than
 * guessing at one, and the `logic/` folders it will translate are unchanged
 * either way.
 */
const config: CapacitorConfig = {
  appId: 'com.egebaykal.agentix',
  appName: 'Agentix',

  // Points at the web build rather than a copy, exactly as Android does. One
  // source of truth; `npm run sync` rebuilds it before every native sync.
  webDir: '../agentix-web/dist',

  ios: {
    // The WebView paints its own background before the app's CSS loads. Left
    // white, every cold start flashes white before the dark theme arrives.
    backgroundColor: '#0b0d10',
    contentInset: 'never',
  },

  server: {
    iosScheme: 'capacitor',
  },
}

export default config
