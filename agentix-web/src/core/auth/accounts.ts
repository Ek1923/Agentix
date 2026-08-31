import type { Session } from './index'

/**
 * Who has signed in on this device.
 *
 * This is a convenience list, not a user database. It exists so the sign-in
 * screen can offer "continue as…" instead of making somebody retype an address
 * they have used fifty times, and so a shared machine can show — and clear —
 * which accounts have been used on it.
 *
 * **What is stored, exactly:** an address, which provider it came from, an
 * optional display name, and when it was last used. On this device, in
 * `localStorage`, and nowhere else.
 *
 * **What is not stored:** no password, no access token, no refresh token. The
 * live session already has its own key (`agentix-session`) and its own lifetime,
 * and signing out clears it. An entry here cannot sign anybody in; it can only
 * pre-fill a field. That is deliberate — a list of accounts that also held their
 * tokens would be a list worth stealing.
 *
 * Nothing here is ever sent anywhere. It is not analytics, and no count of it
 * reaches us.
 */

export type AccountProvider = 'email' | 'google' | 'apple' | 'github'

export interface KnownAccount {
  /** The account's user id, which is stable across renames. */
  id: string
  email: string
  provider: AccountProvider
  /** Whatever the person calls themselves, if the app has learned it. */
  name: string | null
  /** Which project it belongs to, so switching projects shows the right people. */
  projectId: string | null
  lastSeenAt: string
}

/* ── Pure ────────────────────────────────────────────────────────────────── */

export function normaliseAccountEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Adds or refreshes an entry, keyed on the account id.
 *
 * Keyed on the id and not the address, so somebody changing their email keeps one
 * row rather than gaining a second that looks like a different person.
 */
export function upsertAccount(
  list: readonly KnownAccount[],
  account: KnownAccount,
): KnownAccount[] {
  const next: KnownAccount = { ...account, email: normaliseAccountEmail(account.email) }
  const existing = list.find((a) => a.id === next.id)
  return existing === undefined
    ? [...list, next]
    : list.map((a) => (a.id === next.id ? { ...a, ...next, name: next.name ?? a.name } : a))
}

export function removeAccount(list: readonly KnownAccount[], id: string): KnownAccount[] {
  return list.filter((a) => a.id !== id)
}

/** Most recently used first — the one you want is almost always the last one. */
export function sortAccounts(list: readonly KnownAccount[]): KnownAccount[] {
  return [...list].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
}

/**
 * The accounts worth offering for a given project.
 *
 * An account belongs to the project that issued it, so pointing the device at a
 * different project must not offer people who cannot sign in there. Entries
 * recorded before projects were tracked carry a null id and are shown for any
 * project rather than hidden — they are still probably yours.
 */
export function accountsForProject(
  list: readonly KnownAccount[],
  projectId: string | null,
): KnownAccount[] {
  return sortAccounts(
    list.filter((a) => a.projectId === null || projectId === null || a.projectId === projectId),
  )
}

export function accountLabel(account: KnownAccount): string {
  const name = account.name?.trim() ?? ''
  return name === '' ? account.email : name
}

const PROVIDER_LABELS: Record<AccountProvider, string> = {
  google: 'Google',
  apple: 'Apple',
  github: 'GitHub',
  email: 'Email',
}

export function providerLabel(provider: AccountProvider): string {
  return PROVIDER_LABELS[provider]
}

/* ── Stored ──────────────────────────────────────────────────────────────── */

const ACCOUNTS_KEY = 'agentix-known-accounts'

export function listAccounts(): KnownAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (a): a is KnownAccount =>
        a !== null && typeof (a as KnownAccount).id === 'string' && typeof (a as KnownAccount).email === 'string',
    )
  } catch {
    return []
  }
}

function writeAccounts(list: readonly KnownAccount[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(ACCOUNTS_KEY)
    else localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list))
  } catch {
    // A blocked store means the list does not survive a reload. The app still
    // works; it just stops offering shortcuts.
  }
}

/** Records a successful sign-in. Called after a session exists, never before. */
export function rememberAccount(
  session: Session,
  provider: AccountProvider,
  projectId: string | null,
  name: string | null = null,
): KnownAccount {
  const account: KnownAccount = {
    id: session.userId,
    email: normaliseAccountEmail(session.email),
    provider,
    name,
    projectId,
    lastSeenAt: new Date().toISOString(),
  }
  writeAccounts(upsertAccount(listAccounts(), account))
  return account
}

/**
 * Gives an account your own name for it.
 *
 * The label the app learns from a provider is whatever that provider hands over,
 * which is often nothing. Being able to write "work" and "personal" next to two
 * addresses is the difference between a list you can use and one you have to read.
 *
 * An empty name clears it, falling back to the address rather than showing blank.
 */
export function renameAccount(id: string, name: string): void {
  const trimmed = name.trim()
  writeAccounts(
    listAccounts().map((a) => (a.id === id ? { ...a, name: trimmed === '' ? null : trimmed } : a)),
  )
}

/**
 * Forgets one account on this device.
 *
 * Deletes nothing on the server and ends no session but its own — this is the
 * device's list, and only that. Someone removed here can sign in again by typing
 * their address.
 */
export function forgetAccount(id: string): void {
  writeAccounts(removeAccount(listAccounts(), id))
}

export function forgetAllAccounts(): void {
  writeAccounts([])
}

/* ── Which provider a redirect came back from ────────────────────────────── */

const PENDING_KEY = 'agentix-oauth-pending'

/**
 * Remembers which button was pressed, across the trip to Google or Apple.
 *
 * The fragment a provider returns says nothing about which provider it was, and
 * by then the page that knew has been unloaded. One value, written immediately
 * before leaving and consumed immediately on return.
 */
export function notePendingProvider(provider: AccountProvider): void {
  try {
    localStorage.setItem(PENDING_KEY, provider)
  } catch {
    // Worst case the account is recorded as an email sign-in. Not worth failing over.
  }
}

/** Reads and clears it, so a later ordinary sign-in is not mislabelled. */
export function takePendingProvider(): AccountProvider | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    localStorage.removeItem(PENDING_KEY)
    return raw !== null && raw in PROVIDER_LABELS ? (raw as AccountProvider) : null
  } catch {
    return null
  }
}
