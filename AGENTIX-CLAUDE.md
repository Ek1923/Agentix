# Agentix — Project Brief

Owner: Ege Baykal · Version: 1.0 · Web build

You are building Agentix, an offline-first, plugin-based personal agenda and
productivity app. This document is the source of truth for *intent*. If a request
conflicts with it, say so instead of silently choosing.

---

## Where this actually landed — read before section 0

This brief was written for Phase 0. **All six phases are built.** Nine plugins ship
rather than the five locked below, the sync engine is done, and the rank system is
personal-only until an organisation exists. Sections 0 and 7 describe a starting
point that is behind you: do not treat "build only Phase 0" as a live instruction,
and do not delete work because it is not in the phase table.

Two decisions have moved since, and both are recorded in the table below rather
than only here:

- **Sync is split across two backends** (2026-08-30). The organisation's own
  self-hosted identity server holds `organizations`, `memberships` and `people`;
  every other table lives in each person's own Supabase project. An earlier version
  of `agentix-v1-structure.md` said there was no `server/` and no self-hosting.
  There is. Do not "correct" it back.
- **Accounts are gated off** behind `core/features.ts` until that server answers.

`BACKLOG.md` is where the current state and everything deferred is written down —
read it before deciding anything is missing.

---

## 0. Rules for you, the agent

Read these before writing any code.

1. **Build only the current phase.** Phase 0 is defined below. Do not scaffold
   Phase 1 files "to save time." Empty folders for future plugins are fine; code in
   them is not.
2. **Stop at the phase gate.** When Phase 0's acceptance tests pass, stop and report.
   The owner tests manually before Phase 1 begins.
3. **Never write a secret to disk.** No API keys, no Supabase keys, no tokens in any
   committed file. Secrets go in `.env.local` (gitignored) or device secure storage.
4. **Never log a key.** Not in `console.log`, not in a thrown error, not in a comment.
5. **Ask when the spec is silent.** A wrong guess costs more than a question.
6. **No placeholder data in shipped code.** If a screen has nothing to show, build the
   real empty state, not a hardcoded fake task.
7. **TypeScript strict mode on.** No `any` unless you write a comment explaining why.

---

## 1. Locked decisions

| Topic | Decision |
|---|---|
| Platform (this repo) | Web. React + TypeScript + Vite. |
| Storage | Offline-first. Local DB is the source of truth. |
| Local DB | Dexie (IndexedDB) |
| State | Zustand |
| Styling | Tailwind |
| Motion | Framer Motion |
| Auth + sync | Split: the org's own identity server (Keycloak + PostgREST, `server/`) for identity and the shared pool; each person's own Supabase for their content. Routing in `core/sync/backends.ts`. |
| Hosting | GitHub Pages, custom domain |
| AI keys | Device-only. Never synced, never server-side. |
| AI providers | Multiple. User picks the active one. |
| Plugins in v1 | Nine ship: Task Manager, Agenda, Note Taker, Reconsider, Backtest, plus Flow, Workload, Habits and Tags added at the owner's request. `BACKLOG.md` records why. |

Out of scope for v1: advanced agenda mode, watchOS, iPad-specific layouts, native
desktop apps, any plugin not in the list above.

---

## 2. Data model

Four plugins read this data. It must be correct before anything is built on it.

```ts
// packages/core/db/types.ts

export type TaskStatus = 'todo' | 'active' | 'done' | 'missed'

export interface Task {
  id: string                 // uuid, generated on device
  title: string
  notes: string | null
  status: TaskStatus
  plannedFor: string         // ISO date 'YYYY-MM-DD' — which day it belongs to
  estimateMin: number | null // user's own guess, drives accuracy scoring
  completedAt: string | null // ISO datetime
  priority: 0 | 1 | 2
  tags: string[]

  createdAt: string
  updatedAt: string          // drives sync conflict resolution
  deletedAt: string | null   // soft delete — never hard delete
}

export interface TimeSession {
  id: string
  taskId: string
  startedAt: string          // clock in
  endedAt: string | null     // null means the timer is running right now
  source: 'timer' | 'manual'

  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Note {
  id: string
  taskId: string | null      // null = standalone note
  content: string
  aiSummary: string | null

  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
```

### Rules that are not obvious from the types

- **One task has many sessions.** Start, pause for lunch, resume = two sessions on one
  task. Actual time spent is the sum of that task's sessions. Never store a
  `timeSpent` number on Task — it loses *when* the work happened, and the backtest
  plugin needs the when.
- **Exactly one session may have `endedAt: null` at a time.** Starting a timer while
  another runs must close the first one. Enforce this in the DB layer, not the UI.
- **Soft deletes only.** A delete is an update with `deletedAt` set, so it can sync
  like any other edit. Every query filters `deletedAt == null`.
- **Never prune old rows.** The backtest window goes up to 30 days and a year of
  tasks is well under a megabyte.
- **All timestamps are ISO 8601 UTC strings.** `plannedFor` is the one exception —
  it is a local calendar date, because "which day is this task on" is a local
  question. Do not store it as a UTC datetime or tasks jump days across timezones.

---

## 3. Repository layout

All three platform builds live in one repository. You are working in `agentix-web`
only — do not create files in the android or ios folders.

```
Agentix/                      ← repo root, open this in the editor
├── AGENTIX-CLAUDE.md         ← this file
├── agentix-v1-structure.md   ← architecture reference
├── agentix-web/              ← build here first (React + TypeScript)
├── agentix-android/          ← empty until web is proven
└── agentix-ios/              ← empty, Swift, built last
```

Only `agentix-web` deploys to GitHub Pages. The mobile folders live in the same repo
but ship through the App Store and Play Store.

---

## 4. Web folder structure

Create this. Empty folders for later phases are expected.

```
agentix-web/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   │
│   ├── core/
│   │   ├── db/
│   │   │   ├── types.ts          # the interfaces above
│   │   │   ├── db.ts             # Dexie instance + schema
│   │   │   └── queries.ts        # every read/write goes through here
│   │   ├── ai/
│   │   │   ├── index.ts          # ai.complete() — the only entry point
│   │   │   ├── secure-store.ts   # key read/write
│   │   │   └── providers/
│   │   │       ├── types.ts
│   │   │       ├── anthropic.ts
│   │   │       └── openai.ts
│   │   ├── plugin-host/
│   │   │   ├── types.ts          # Plugin + PluginContext
│   │   │   └── registry.ts       # list of installed plugins
│   │   └── settings/
│   │       └── store.ts          # zustand, persisted
│   │
│   ├── ui/
│   │   ├── tokens.ts             # spacing, radius, motion timings
│   │   └── components/           # Tile, Card, Button, Select, EmptyState
│   │
│   ├── shell/
│   │   ├── ProfileBar.tsx        # top — profile
│   │   ├── TileGrid.tsx          # the plugin menu
│   │   └── SettingsButton.tsx    # top right
│   │
│   ├── screens/
│   │   ├── Home.tsx
│   │   ├── Settings.tsx
│   │   └── settings/ApiKeys.tsx
│   │
│   └── plugins/                  # empty until Phase 1
│       ├── task-manager/
│       ├── agenda/
│       ├── note-taker/
│       ├── reconsider/
│       └── backtest/
│
├── .env.local                    # gitignored
└── .gitignore
```

Each plugin folder, once built, has the same shape:

```
plugins/task-manager/
├── manifest.ts       # id, name, icon, version
├── index.tsx         # exported entry component
└── logic/            # pure functions, no React
```

**Keep business logic in `logic/` as pure functions.** When this is rebuilt in Swift
for iOS, those files are the specification — they get translated line by line instead
of re-invented. This is the single highest-value convention in the project.

---

## 5. Plugin contract

The shell must never special-case a plugin. Every plugin exports the same shape:

```ts
// core/plugin-host/types.ts

export interface Manifest {
  id: string
  name: string
  icon: string          // lucide icon name
  version: string
  requiresAI: boolean   // shell shows a hint if no key is configured
}

export interface PluginContext {
  db: Queries           // from core/db/queries
  ai: AIService         // from core/ai
  navigate: (to: string) => void
}

export interface AgentixPlugin {
  manifest: Manifest
  Component: React.FC<{ ctx: PluginContext }>
}
```

Plugins must not: open their own Dexie connection, read secure storage directly, or
call an AI provider's URL directly. Everything goes through `ctx`. This is what makes
a future server-proxy option a one-file change.

---

## 6. AI provider layer

The provider dropdown means `ai.complete()` hides all provider differences.

```ts
// core/ai/providers/types.ts

export interface Provider {
  id: 'anthropic' | 'openai'
  label: string
  models: string[]
  keyPattern: RegExp        // catch typos before spending a request
  complete(key: string, model: string, prompt: string): Promise<string>
}
```

- One key stored per provider, each under its own name in secure storage.
- One `activeProvider` setting names which is in use.
- Adding a provider later = one new file in `providers/`. No plugin changes.

Web storage note: IndexedDB is the store on web, and it is weaker than a phone's
Keychain. Say so in the UI, once, plainly — one line under the key field. Do not
bury it and do not exaggerate it.

---

## 7. PHASE 0 — what to build now

**Goal:** a working shell with no plugins. Prove the foundation before building on it.

### Deliverables

1. **Project setup** — Vite React+TS, Tailwind configured, strict mode on,
   `.gitignore` covering `.env.local`.

2. **Database** — `core/db/db.ts` with the Dexie schema for `tasks`, `sessions`,
   `notes`. Index `plannedFor`, `status`, `taskId`, `startedAt`.
   `core/db/queries.ts` with typed CRUD that sets `createdAt`/`updatedAt`
   automatically, filters `deletedAt`, and enforces the one-running-session rule.

3. **Shell UI** — `Home.tsx` with the profile bar at top, settings gear top-right,
   and a tile grid below. Tiles are read from `plugin-host/registry.ts`, which
   returns an empty array in Phase 0. So Home must render a real empty state:
   "No plugins installed yet."

4. **Settings → API page** — provider dropdown, key input (masked), save, delete, and
   a **Test connection** button that fires one minimal request and reports success or
   failure. Without the test button, a bad key is indistinguishable from a broken
   plugin later.

5. **Design tokens** — `ui/tokens.ts` with spacing, radii, and motion durations.
   Motion timings will be reused in the iOS build, so pick them deliberately: fast
   (150ms) for taps, medium (250ms) for screen transitions, ease-out curves.

### Do NOT build in Phase 0

Any plugin. Supabase or login. Sync. Google Calendar. A timer UI.

### Acceptance tests

Phase 0 is done when all of these pass:

- [ ] `npm run dev` starts with no console errors
- [ ] Home shows profile bar, settings gear, and the empty state
- [ ] Settings → API saves a key, and it survives a full page reload
- [ ] Switching the provider dropdown keeps each provider's key separate
- [ ] Test connection reports a clear result for both a valid and an invalid key
- [ ] Deleting a key removes it from IndexedDB, verified in DevTools
- [ ] `npm run scan-secrets` reports clean
      (replaces `grep -ri "sk-" src/`, which cannot pass: §6 mandates a
      `keyPattern: RegExp` and any honest pattern contains the prefix.
      `scan-secrets` matches key-*shaped* literals and scans `dist/` too.)
- [ ] TypeScript builds clean with strict mode

Report which tests pass and which do not. Do not start Phase 1.

---

## 8. Phases after this one

Order is deliberate — Task Manager owns the schema four other plugins read.

| Phase | Plugin | Gate |
|---|---|---|
| 1 | Task Manager + timer | Timer survives a tab close mid-session |
| 2 | Agenda (basic) | Tasks land on the right day; Google Calendar imports |
| 3 | Note Taker AI | Works with a key, degrades cleanly without one |
| 4 | Reconsider | Suggestions make sense on real data |
| 5 | Backtest | Window selector 5/10/15/20/30, numbers match reality |
| 6 | Supabase auth + sync | Two browsers offline, reconnect, no data lost |

Nothing advances until the owner has tested the previous phase.

---

## 9. Conventions

- Functional components, hooks, no classes.
- No `useEffect` for data fetching — use Dexie's `useLiveQuery` so the UI updates
  when the DB changes.
- IDs are `crypto.randomUUID()`.
- Dates via `date-fns`. No moment.
- One component per file, named the same as the file.
- Comments explain *why*, never *what*.
