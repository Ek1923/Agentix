# agentix-web

The web build of Agentix — offline-first, plugin-based. React + TypeScript + Vite.

All seven v1 phases are built: the shell, Task Manager, Agenda, Note Taker,
Reconsider, Backtest, and Supabase auth + sync. Four plugins ship beyond the
brief's five — Flow, Workload, Habits and Tags.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

**The app will not open past the sign-in gate without a Supabase project.** Since
sign-in became mandatory, a device that has never been pointed at a project gets
the first-run setup on the gate itself rather than a way in. That is deliberate —
Settings lives behind the gate, so the gate has to carry the setup.

To get in, either put a project's values in `.env.local`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

or paste the same two values into the first-run panel on the gate. Both are
publishable by design — the anon key ships in the bundle, and row-level security
is what actually protects the data. `src/core/sync/README.md` has the SQL that
creates the tables and the policies, and the redirect URLs sign-in needs.

Signing in is optional. Everything except syncing and organisations works with no
account at all, so the app opens straight to Home and the sign-in screen is reached
deliberately from Settings.

**[CONNECTING.md](CONNECTING.md) is the walkthrough** — why a project is needed at
all, the ten-minute setup, keeping several projects on one device, what the status
light sends, and what the account list does and does not store.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then production build into `dist/` |
| `npm run typecheck` | TypeScript only, strict mode |
| `npm test` | Full suite |
| `npm run test:watch` | Tests in watch mode |
| `npm run lint` | oxlint |
| `npm run scan-secrets` | Fails loudly if a key-shaped literal is in `src/` or `dist/` |

## Layout

```
src/
├── core/            platform-independent, no UI — this is what ports to Swift
│   ├── db/          types, Dexie schema, and the only place reads and writes happen
│   ├── ai/          ai.complete(), key storage, one file per provider
│   ├── plugin-host/ plugin contract and the installed-plugin registry
│   ├── auth/        sign-in over GoTrue, session in localStorage
│   ├── sync/        merge rules, sync engine, Supabase transport
│   ├── org/         roles, seats, roster — shared workspaces
│   └── settings/    zustand, persisted
├── ui/              design tokens, icon set, shared components
├── shell/           profile bar, plugin bar, command palette, hash router
├── screens/         SignIn, Home, Profile, Theme, Organisation, Settings
└── plugins/         task-manager, agenda, note-taker, reconsider, backtest,
                     flow, workload, habits, tags
```

## Conventions that matter

**Business logic lives in `core/` and in each plugin's `logic/`, as pure functions.**
When this is rebuilt in Swift, those files are the specification — they get
translated line by line instead of re-invented. This is the highest-value
convention in the project, and the reason `core/` has no React imports.

**A manifest is eager; the plugin behind it is not.** `core/plugin-host/registry.ts`
imports all nine manifests directly and wraps each component in `React.lazy`. The
menu needs every name and icon on first paint, but it needs at most one plugin's
code — and only once someone opens it. Importing the components directly is the
easy accident to make here: it typechecks, it works, and it quietly puts all nine
plugins back into the entry bundle.

**Everything a plugin touches arrives through `ctx`.** A plugin never opens its own
Dexie connection, never reads a key, never calls a provider URL. That is what makes
a future server-proxy option a one-file change.

**Storage rules.** Soft deletes only, every query filters `deletedAt == null`, and
all timestamps are ISO 8601 UTC — except `plannedFor`, which is a local calendar
date on purpose, so tasks do not jump days across timezones.

## Where keys live

API keys are stored on the device, in a **separate IndexedDB database**
(`agentix-secure`) from application data (`agentix`).

The separation is deliberate. The Phase 6 sync layer walks the application
database; a key that is not in that database cannot be pushed to a server by an
accident, a refactor, or a later contributor adding a table to the sync list. The
structure enforces it rather than a comment asking someone to remember.

Keys are never logged, never put into an error message, and never rendered — the
settings screen shows a masked tail only.

IndexedDB is weaker than a phone keychain. The settings screen says so, once,
plainly, under the key field.

## Testing note

`fake-indexeddb` gives the tests a real IndexedDB, so Dexie runs unmodified and
transactions behave as they do in a browser. Test fixtures for API keys contain
the literal `FAKEKEYFORTESTS` so `scan-secrets` can tell a fixture from a leak.
