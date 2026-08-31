/**
 * Build-time feature switches.
 *
 * A single, honest place to turn a whole capability off while the thing it needs
 * does not exist yet — rather than half-deleting screens and wiring them back
 * later from memory.
 *
 * **accounts** gates everything that requires a server: signing in, the sync and
 * connection panels, organisations, and the shared pool of people. It is off
 * until the org's own identity server is standing (see `SERVER-SETUP.md`). With it
 * off, Agentix is exactly the local, single-device app it has always been — every
 * plugin works, nothing dead-ends on a login it cannot complete. Flip this to
 * `true` the day the server answers, and the login screen, the sync lights and the
 * pool light up together.
 *
 * These are compile-time constants, so a disabled branch is dead code the bundler
 * can see — not a runtime check someone can toggle in the console.
 */
export const features = {
  /** Signing in, sync, organisations, and the shared pool. Off until the server exists. */
  accounts: false,
} as const

export type Features = typeof features
