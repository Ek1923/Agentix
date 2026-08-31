# Agentix v1.0 — Build Structure

**By Ege Baykal**

> **Status: all seven phases are built.** Where this document and
> `AGENTIX-CLAUDE.md` disagree, `AGENTIX-CLAUDE.md` is the source of truth — it
> says so itself, and the build followed it. §3 and §9 have been brought back in
> line with what actually shipped; the rest of this file is the original plan and
> is kept for the reasoning behind each decision, not as a description of the code.

---

## 1. Decisions locked so far

| Topic | Decision |
|---|---|
| Storage | Offline-first. Local DB is the source of truth, sync when online. |
| Plugin format | Signed JS/TS bundle + manifest. Docker is backend-only. |
| API keys | Device-only. Keychain / Keystore / IndexedDB. Never on the server. Multiple providers, user picks active one. |
| Backend | ~~Supabase (hosted). No Docker, no self-hosting.~~ **Superseded 2026-08-30:** two backends — the org's own self-hosted identity server (Docker: Keycloak + Postgres + PostgREST) for identity and the shared pool, plus each person's own Supabase for their content. See §3. |
| Hosting | GitHub Pages + custom domain for web. App Store / Play Store for mobile. |
| Login | Google, Apple, GitHub, email+password. Over Supabase Auth today; the destination is Keycloak on the org's server signing a token every member's Supabase verifies. Not built yet. |
| Calendar | Google Calendar in v1. Apple EventKit in v2. |
| Agenda | Basic only in v1. Advanced deferred. |
| Backtesting | Todos + completed tasks + time spent + clock-in/clock-out. Window selectable: 5 / 10 / 15 / 20 / 30 days. |
| Platform order | Web (TSX) → Android (TSX) → iOS (Swift). |
| Workflow | One plugin at a time. Nothing new starts until the current one is approved. |

---

## 2. Data model

This is the most important section. Four other plugins read this data, so getting it
right now prevents four migrations later.

### Task

```ts
{
  id: string            // uuid, generated on device
  title: string
  notes: string | null
  status: 'todo' | 'active' | 'done' | 'missed'
  plannedFor: string    // ISO date, which day it belongs to
  estimateMin: number | null   // how long the user thinks it takes
  completedAt: string | null
  priority: 0 | 1 | 2
  tags: string[]

  createdAt: string
  updatedAt: string     // drives sync conflict resolution
  deletedAt: string | null   // soft delete, never hard delete
}
```

### TimeSession — the clock in / clock out record

```ts
{
  id: string
  taskId: string
  startedAt: string     // clock in
  endedAt: string | null   // null = timer currently running
  source: 'timer' | 'manual'

  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
```

One task can have many sessions. Start a task, stop for lunch, resume — that's two
sessions on one task. Actual time spent is the sum of all sessions.

**Why it is separate from Task:** if you store `timeSpent` as a single number on the
task, you lose *when* the work happened. Backtesting needs the when, because
clock-in/clock-out patterns are half of what you asked for.

### Note

```ts
{
  id: string
  taskId: string | null   // null = standalone note
  content: string
  aiSummary: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
```

### Derived — never stored

Backtesting computes these on the fly from Task + TimeSession, over a window the user picks:

```ts
type BacktestWindow = 5 | 10 | 15 | 20 | 30   // days
```

- completion rate = done / planned, per day
- estimate accuracy = estimateMin vs. summed session minutes
- focus time = total tracked minutes per day
- first clock-in and last clock-out per day
- longest unbroken session

Storing derived values means they go stale. Compute them, cache the result in memory.

**Why the selectable window is free:** every metric is a query over
`sessions.startedAt BETWEEN today-N AND today`. Changing N changes one number in a
`where` clause. No schema change, no migration, no extra storage.

Two rules it does impose:

- **Retention.** Never prune Task or TimeSession rows younger than 30 days on device,
  or the 30-day view breaks. Simplest answer for v1: never prune at all. A year of
  tasks is well under a megabyte.
- **Sparse data.** A new user picking 30 days has 30 days of nothing. Show days with
  no data as empty rather than as zero — a flat line at zero reads like failure when
  it just means the app wasn't installed yet.

Default window: 10 days. Long enough to show a pattern, short enough to feel current.
Persist the user's choice in local settings so it survives a reload.

---

## 3. Folder structure

All three platform builds live in one repository:

```
Agentix/                      ← repo root
├── AGENTIX-CLAUDE.md         ← agent brief
├── agentix-v1-structure.md   ← this file
├── agentix-web/              ← built first
├── agentix-android/          ← ported from web
├── agentix-ios/              ← Swift, built last
└── server/                   ← the org's own identity server (compose + schema)
```

Inside `agentix-web`:

```
agentix-web/
├── index.html
├── vite.config.ts
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── core/                   # platform-independent, no UI — ports to Swift
    │   ├── db/                 # types, Dexie schema, the only read/write gateway
    │   ├── sync/               # merge rules, engine, Supabase transport, the
    │   │                       #   saved-project list and the health heartbeat
    │   ├── ai/                 # ai.complete(), key storage, one file per provider
    │   ├── auth/               # sign-in over GoTrue, session in localStorage,
    │   │                       #   and this device's list of known accounts
    │   ├── org/                # organisations: roles, permissions, seat limits
    │   ├── plugin-host/        # plugin contract and the installed-plugin registry
    │   ├── settings/           # zustand, persisted
    │   ├── dates.ts            # pure date maths — the Swift port reads this file
    │   ├── stats.ts            # pure aggregation, same
    │   ├── rank.ts             # xp, levels, tiers and streaks — pure, same
    │   └── habits.ts           # when a routine is due, and the card it becomes
    ├── ui/                     # design tokens, icon set, shared components
    │   ├── tokens.ts           # colors, spacing, motion timings
    │   ├── feedback.ts         # named interaction moments → haptics on iOS
    │   └── components/
    ├── shell/                  # profile bar, plugin bar, command palette, router,
    │                           #   and when the heartbeat is allowed to run
    ├── screens/                # SignIn, Home, Profile, Theme, Settings, Organization
    └── plugins/
        ├── task-manager/
        ├── agenda/
        ├── note-taker/
        ├── reconsider/
        ├── backtest/
        ├── flow/
        ├── workload/
        ├── habits/
        └── tags/
```

There is no `packages/`. The monorepo split this document originally described was
never built: `core/` is a folder inside `agentix-web/src`, not a published package,
and it stays free of React imports by convention rather than by a package boundary
— which is what actually matters for the Swift port.

`server/` **does** exist, and this document said for a while that it did not. That
line was written when everything ran against one hosted Supabase project. Since
2026-08-30 Agentix syncs against **two backends at once**, which is a deliberate
liability split rather than a technical preference:

- **The organisation's own identity server** — `server/`, a Docker compose of
  Keycloak, Postgres, PostgREST and a Cloudflare tunnel, deployed to the owner's
  Ubuntu box by `.github/workflows/deploy-id-server.yml`. It holds only the light
  coordination layer: `organizations`, `memberships` and `people` (the shared
  pool). Names, addresses, labels — never authored content.
- **Each person's own Supabase project** — `tasks`, `notes`, `sessions`,
  `buckets`, `habits`, `habit_logs`. Everything someone writes stays in a project
  they own, so a leak is theirs to contain rather than the organisation's.

Which table lives where is data, not folklore: `core/sync/backends.ts` maps every
`SyncTable` to a backend and the engine routes on it. The trust model is
asymmetric — Keycloak signs the token, each Supabase verifies it with the public
key, and no shared secret leaves the server. The client half of that (the identity
transport and the Keycloak login) is **not built yet**; until it is,
`core/features.ts` keeps accounts switched off. The owner's private runbook is
`SERVER-SETUP.md`, and the app-side detail is in
`agentix-web/src/core/sync/README.md`.

Every plugin folder has the same shape:

```
plugins/task-manager/
├── manifest.ts       # id, name, icon, version, requiresAI
├── index.tsx         # exported entry component
├── logic/            # pure functions, no React — portable to Swift later
└── README.md         # what it does, what it reads, what it writes
```

Keeping business logic in `logic/` as pure functions matters more than it looks. When
you rebuild for iOS in Swift, those files are your specification — you translate them
line by line instead of re-inventing the behaviour.

---

## 4. Plugin contract

Every plugin exports the same interface, so the shell never special-cases anything:

```ts
interface AgentixPlugin {
  manifest: Manifest
  Component: React.FC<{ ctx: PluginContext }>
}

interface PluginContext {
  db: Database          // scoped queries
  ai: AIService         // ai.complete() — resolves key from secure storage
  nav: Navigator
  user: User
}
```

Plugins never touch API keys, never open their own DB connection, never call fetch on
a provider directly. Everything goes through `ctx`. That's what makes the v2 proxy
option a one-file change.

---

## 5. AI providers

The dropdown means `ai.complete()` has to hide provider differences from plugins.
One adapter per provider, one shared interface:

```ts
interface Provider {
  id: 'anthropic' | 'openai' | 'google'
  label: string
  models: string[]
  keyFormat: RegExp        // catch typos before a request is sent
  complete(key, model, prompt): Promise<string>
}
```

Settings → API stores one key per provider, each in secure storage under its own
name, plus a single `activePro***` setting. Adding a provider later means adding one
file to `core/ai/providers/` — no plugin changes.

Three things worth building in from the start:

- **Test button.** One cheap request per provider that proves the key works. Without
  it, a bad key looks identical to a broken plugin.
- **Per-provider empty state.** If the active provider has no key, the AI plugins show
  a card pointing at settings — not an error.
- **Never log the key.** Not in console, not in error messages. Easy to leak while
  debugging and easy to forget before you push to a public repo.

---

## 6. Tech stack (web build)

| Layer | Choice | Why |
|---|---|---|
| Framework | React + TypeScript + Vite | Fast reload, TSX carries to Android |
| Local DB | Dexie (IndexedDB) | Real queries offline, small API |
| State | Zustand | Minimal, no boilerplate |
| Styling | Tailwind + shadcn/ui | Tiles and settings pages come out clean |
| Motion | Framer Motion | Timings you will re-use on iOS |
| Auth + sync | Supabase | Google/Apple/GitHub/email login and Postgres, hosted |
| Hosting | GitHub Pages | Static output, free, custom domain |

---

## 7. Build order

Not the order you listed them in. Task Manager is the foundation — four plugins read
its data, so its schema has to be settled before anything else is written.

**Phase 0 — Shell**
Folder setup, DB schema, tile menu, profile bar, settings with the API key page.
No plugins yet. Test: app opens, key saves, key survives a refresh.

**Phase 1 — Task Manager**
CRUD, plus the timer: clock in, clock out, sessions written correctly.
Test: create tasks, run a timer, close the tab mid-timer, reopen — timer still running.

**Phase 2 — Agenda (basic)**
Day view reading tasks by `plannedFor`. Google Calendar read-only import.
Test: tasks appear on the right day, calendar events show alongside.

**Phase 3 — Note Taker AI**
Notes linked to tasks, AI summary through `ctx.ai`. Empty state when no key is set.
Test: works with a key, degrades gracefully without one.

**Phase 4 — Reconsider**
Reads the last N days, suggests re-planning missed tasks.
Test: suggestions make sense on real data, not invented data.

**Phase 5 — Backtesting**
Completion rate, estimate accuracy, clock-in/out pattern, focus time.
Window selector: 5 / 10 / 15 / 20 / 30 days, choice persisted.
Test: numbers match what you actually did that week, and switching the window
recomputes correctly instead of re-fetching everything.

**Phase 6 — Auth + sync**
Supabase project, Google/Apple/email login, push/pull, offline edits reconcile.
Test: edit on two browsers offline, both reconnect, no data lost.

You approve each phase before the next one starts.

### Where each phase actually stands

All seven are built, typecheck clean, full suite green. Three carry a test that
only the owner can run, because it needs a credential or an account:

| Phase | Built | Still unverified |
|---|---|---|
| 0 Shell | yes | — |
| 1 Task Manager | yes | drag-and-drop, which jsdom cannot do |
| 2 Agenda | yes | Google Calendar import — needs an OAuth client ID |
| 3 Note Taker | yes | a real request to Anthropic or OpenAI |
| 4 Reconsider | yes | — |
| 5 Backtest | yes | — |
| 6 Auth + sync | yes | never contacted a real Supabase project |

`BACKLOG.md` carries each of those with the steps to unblock it.

---

## 8. Sync rules

- Every record carries `updatedAt` and `deletedAt`.
- Last write wins, compared by `updatedAt`.
- Deletes are soft, so a delete can sync like any other edit.
- A `dirty` flag marks records changed since the last successful push.
- Running timers (`endedAt: null`) do not sync until closed — avoids duplicate
  sessions when two devices both think they are tracking.
- API keys are excluded from sync. Permanently.

---

## 9. Scope notes

- **Nine plugins.** The brief locked five — Task Manager, Agenda, Note Taker,
  Reconsider, Backtest. Four more were added at the owner's request and now
  ship: Flow, Workload, Habits and Tags. Their scopes are kept deliberately
  distinct; see each plugin's README.
- **Watch and iPad** are not in v1. iPad comes close to free once iOS exists;
  watchOS is a separate app target and belongs in v2.
- **Advanced Agenda** is still v2.
- **Apple requirement:** offering *any* third-party login makes Sign in with Apple
  mandatory on the App Store — Google and GitHub each trigger it on their own, and
  all three ship. Don't drop Apple later thinking it is optional. The web build is
  under no such rule.
