import { create } from 'zustand'
import {
  loadSession,
  refresh,
  signIn as signInRequest,
  signOut as clearSession,
  signUp as signUpRequest,
  type AuthResult,
  type Session,
} from './index'

/**
 * Who is signed in, as one shared fact.
 *
 * The session already lives in localStorage; this is not a second copy of the
 * truth but the subscription to it. Without it the gate and the account panel
 * read `loadSession()` at different moments and disagree — signing out in
 * Settings would leave the app still rendered behind it.
 *
 * Deliberately not persisted by Zustand: `core/auth` owns the storage key, and a
 * second writer would be a second thing to invalidate on sign-out.
 */
interface AuthState {
  session: Session | null
  /** Null until the stored session has been checked against the server. */
  checked: boolean
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string) => Promise<AuthResult>
  signOut: () => void
  adopt: (session: Session | null) => void
  /** Revalidates a stored session on open. */
  restore: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  // Read synchronously so a returning user never sees the sign-in screen flash
  // before their own session loads.
  session: loadSession(),
  checked: false,

  async signIn(email, password) {
    const result = await signInRequest(email, password)
    if (result.session !== undefined) set({ session: result.session })
    return result
  },

  async signUp(email, password) {
    const result = await signUpRequest(email, password)
    if (result.session !== undefined) set({ session: result.session })
    return result
  },

  signOut() {
    clearSession()
    set({ session: null })
  },

  adopt(session) {
    set({ session })
  },

  async restore() {
    const stored = loadSession()
    if (stored === null) {
      set({ checked: true })
      return
    }

    // `refresh` returns the session untouched when the server is unreachable, and
    // null only when it was actually rejected. Offline stays signed in.
    const next = await refresh(stored)
    set({ session: next, checked: true })
  },
}))
