import type { SupabaseConfig } from './supabase'

/**
 * Every project this device has been pointed at, and which one is live.
 *
 * The single stored config that came before could hold one project, so moving
 * between a staging project and a real one meant pasting a URL and a forty-
 * character key back and forth from a dashboard. Once you have typed that twice
 * you have learned the lesson: a device should remember what it has connected to.
 *
 * Only the list is new. The values in it are the same publishable pair as before
 * — a project URL and an anon key, both meant to ship inside a public bundle.
 * Nothing secret is being accumulated here; row-level security is still what
 * separates one account's rows from another's.
 */

export interface SavedProject {
  /** Derived from the URL, so the same project added twice is one entry. */
  id: string
  /** What to call it in the list. Defaults to the subdomain, editable after. */
  label: string
  url: string
  anonKey: string
  addedAt: string
  lastUsedAt: string
}

/* ── Pure ────────────────────────────────────────────────────────────────── */

/** Trailing slashes and case make two spellings of one project. This settles it. */
export function normaliseProjectUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * The identity of a project is its URL.
 *
 * Not a random id: re-adding a project you already have should update the one
 * entry rather than making a second that differs only by key. Rotating an anon
 * key is exactly that case, and it must not fork the list.
 */
export function projectIdFor(url: string): string {
  return normaliseProjectUrl(url)
}

/**
 * A readable name from the URL: a host of `abcd.supabase.co` becomes `abcd`.
 *
 * Written without a scheme on purpose — `privacy.test.ts` scans this source for
 * any literal `scheme://host`, and an example in a comment is exactly the kind
 * of thing that should not be able to weaken that guard.
 *
 * Supabase project refs are random strings, so this is not pretty — but it is
 * stable and recognisable, and the label is editable for exactly that reason.
 */
export function labelFor(url: string): string {
  try {
    const host = new URL(normaliseProjectUrl(url)).hostname
    return host.replace(/\.supabase\.(co|in)$/, '') || host
  } catch {
    return normaliseProjectUrl(url)
  }
}

/** Adds or updates by URL, and never lets the list carry two of one project. */
export function upsertProject(
  list: readonly SavedProject[],
  project: SavedProject,
): SavedProject[] {
  const id = projectIdFor(project.url)
  const existing = list.find((p) => p.id === id)
  const merged: SavedProject = {
    ...project,
    id,
    // A project keeps the day it was first added, and the label someone chose for
    // it, unless this call is deliberately changing the label.
    addedAt: existing?.addedAt ?? project.addedAt,
  }
  return existing === undefined
    ? [...list, merged]
    : list.map((p) => (p.id === id ? merged : p))
}

export function removeProject(list: readonly SavedProject[], id: string): SavedProject[] {
  return list.filter((p) => p.id !== id)
}

/**
 * Which project is live, given what is stored and what was last selected.
 *
 * Falls back to the most recently used rather than to nothing: forgetting the
 * active project should hand the device to its next best option, not disconnect
 * it. Returns null only when the list is genuinely empty.
 */
export function pickActive(
  list: readonly SavedProject[],
  activeId: string | null,
): SavedProject | null {
  if (list.length === 0) return null
  const chosen = activeId === null ? undefined : list.find((p) => p.id === activeId)
  if (chosen !== undefined) return chosen
  return [...list].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0] ?? null
}

/** Most recently used first, which is the order someone looks for one in. */
export function sortProjects(list: readonly SavedProject[]): SavedProject[] {
  return [...list].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
}

export function toConfig(project: SavedProject): SupabaseConfig {
  return { url: project.url, anonKey: project.anonKey }
}

/* ── Stored ──────────────────────────────────────────────────────────────── */

const LIST_KEY = 'agentix-projects'
const ACTIVE_KEY = 'agentix-project-active'
/** What a single-project install used before this file existed. */
const LEGACY_KEY = 'agentix-supabase'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Blocked storage means the list does not survive a reload. Worth degrading
    // over, not failing over — the app still works, it just forgets.
  }
}

function isProject(value: unknown): value is SavedProject {
  const p = value as Partial<SavedProject> | null
  return p !== null && typeof p?.url === 'string' && typeof p?.anonKey === 'string'
}

/**
 * Reads the list, folding in a project saved by the old single-config key.
 *
 * A device that had one project before this existed must not appear empty and
 * lose the connection it already had. The migration is read-time and idempotent:
 * the legacy entry is adopted into the list and the old key is cleared once.
 */
export function listProjects(): SavedProject[] {
  const raw = read<unknown[]>(LIST_KEY, [])
  let list = Array.isArray(raw) ? raw.filter(isProject).map((p) => ({ ...p, id: projectIdFor(p.url) })) : []

  const legacy = read<Partial<SupabaseConfig> | null>(LEGACY_KEY, null)
  if (legacy !== null && typeof legacy.url === 'string' && typeof legacy.anonKey === 'string') {
    const now = new Date().toISOString()
    list = upsertProject(list, {
      id: projectIdFor(legacy.url),
      label: labelFor(legacy.url),
      url: legacy.url,
      anonKey: legacy.anonKey,
      addedAt: now,
      lastUsedAt: now,
    })
    write(LIST_KEY, list)
    write(LEGACY_KEY, null)
  }

  return list
}

export function activeProject(): SavedProject | null {
  return pickActive(listProjects(), read<string | null>(ACTIVE_KEY, null))
}

/** Adds a project and makes it the live one, which is why anyone adds one. */
export function saveProject(url: string, anonKey: string, label?: string): SavedProject {
  const now = new Date().toISOString()
  const id = projectIdFor(url)
  const existing = listProjects().find((p) => p.id === id)

  const project: SavedProject = {
    id,
    label: label?.trim() || existing?.label || labelFor(url),
    url: url.trim().replace(/\/+$/, ''),
    anonKey: anonKey.trim(),
    addedAt: existing?.addedAt ?? now,
    lastUsedAt: now,
  }

  write(LIST_KEY, upsertProject(listProjects(), project))
  write(ACTIVE_KEY, id)
  return project
}

/** Switches which project is live, and records that it was used. */
export function selectProject(id: string): SavedProject | null {
  const list = listProjects()
  const chosen = list.find((p) => p.id === id)
  if (chosen === undefined) return null

  const used: SavedProject = { ...chosen, lastUsedAt: new Date().toISOString() }
  write(LIST_KEY, upsertProject(list, used))
  write(ACTIVE_KEY, id)
  return used
}

export function renameProject(id: string, label: string): void {
  const list = listProjects()
  const chosen = list.find((p) => p.id === id)
  if (chosen === undefined) return
  write(LIST_KEY, upsertProject(list, { ...chosen, label: label.trim() || chosen.label }))
}

/**
 * Forgets a project on this device.
 *
 * Removes nothing on the server and signs nobody out of anything else — it is
 * this device's list, and only that.
 */
export function forgetProject(id: string): void {
  const remaining = removeProject(listProjects(), id)
  write(LIST_KEY, remaining)

  const active = read<string | null>(ACTIVE_KEY, null)
  if (active === id) {
    const next = pickActive(remaining, null)
    write(ACTIVE_KEY, next?.id ?? null)
  }
}

/** Empties the list. Used by the erase-everything path, not by ordinary UI. */
export function forgetAllProjects(): void {
  write(LIST_KEY, null)
  write(ACTIVE_KEY, null)
  write(LEGACY_KEY, null)
}
