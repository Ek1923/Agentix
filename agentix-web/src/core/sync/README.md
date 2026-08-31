# Sync

Offline-first sync, with the engine kept independent of whatever it is talking to.

## Two backends, on purpose

Since 2026-08-30 a sync pass writes to **two** places, and which table goes where
is a liability decision rather than a technical one:

| Backend | Tables | Where it runs |
|---|---|---|
| `identity` | `organizations`, `memberships`, `people` | the organisation's own server — `server/` in the repo, Keycloak + Postgres + PostgREST behind a Cloudflare tunnel |
| `data` | `tasks`, `notes`, `sessions`, `buckets`, `habits`, `habit_logs` | each person's **own** Supabase project |

Everything a person authors stays in a project they own; the org's server holds
only the light coordination layer. If content ever leaks it leaks from their
project, not from the organisation's box.

`backends.ts` is that map, and it is exhaustive over `SyncTable` — a new table is a
compile error until someone decides which side it belongs to. `runSyncSplit` in
`engine.ts` fans a pass out over both transports.

**The identity half is not built yet.** The routing, the engine and the server's
schema exist; the client transport that talks to PostgREST on that box, and the
Keycloak login that signs the token both sides trust, do not. Until they do,
`core/features.ts` keeps accounts off entirely, and the sections below describe the
`data` half — which is finished. The owner's runbook for the server is
`SERVER-SETUP.md` at the repo root.

## Shape

```
core/sync/
├── merge.ts      conflict rules — pure, no React, no Dexie, no network
├── backends.ts   which backend owns which table — pure data, exhaustive
├── engine.ts     one sync pass, against a SyncTransport interface; runSyncSplit
│                 drives one pass per backend
├── supabase.ts   the transport, over PostgREST
└── README.md     this file, including the SQL you have to run
core/auth/        sign-in over GoTrue, session in localStorage
```

The auth folder is still GoTrue: it is what the app signs in with today. The
destination is Keycloak signing an asymmetric token that every member's Supabase
verifies with the public key — no shared secret leaving the server — and that is
the next thing to build, not something already here.

`merge.ts` is the file the Swift build translates. Both platforms must resolve a
conflict identically or two devices will disagree about the same row forever.

## The rules, from the brief

- **Last write wins**, compared by `updatedAt`.
- **Deletes are soft**, so a delete merges like any other edit.
- **A dirty flag marks records changed since the last successful push.** This is
  implemented as an outbox table rather than a column — see below.
- **Running timers do not sync until closed.** `endedAt: null` means the clock is
  still going; pushing it lets a second device close or duplicate the session.
- **API keys are excluded from sync. Permanently.** They live in a different
  IndexedDB database, so the sync layer cannot see them even by mistake.

## Why an outbox instead of a dirty column

A `dirty` boolean would mean adding a field to all seven entities, setting it on
every write path, and clearing it after a push that might half-fail. The outbox is
one table keyed by `table:rowId`: editing a row twenty times queues it once, and
clearing it is a delete of exactly the entries the server accepted.

It also avoids the alternative of using `updatedAt` as a high-water mark, which
would strand every row written before a device clock jumped backwards.

Every mutation in `core/db/queries.ts` enqueues. That is only safe to promise
because that module is the single gateway to storage — no plugin opens its own
connection, so there is no write path that can bypass the queue.

## Order of operations

Push first, then pull. Pulling first would apply a server row over a local edit
that has not been sent yet, and the local edit would then be pushed on top: two
round trips to reach the same place, with a visible flicker in between.

## Two details that matter

**The cursor rewinds one millisecond** after each pull, so a row written in the
same millisecond as the newest one seen is not skipped. Re-fetching a row already
held is harmless; skipping one loses an edit.

**Identical timestamps are a no-op**, not "remote wins". Because of that rewind,
the newest row arrives again on every pull — treating it as a change would rewrite
an identical row forever.

## Setting it up

Sync is optional. Without configuration the app works exactly as it does now, and
the Account panel says so rather than failing.

**1. Create a Supabase project**, then put its values in `agentix-web/.env.local`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Both are publishable by design — the anon key ships in the bundle, and row-level
security is what actually protects the data. That is the opposite of an AI key,
which never goes near a build variable.

**2. Run this SQL** in the Supabase SQL editor. Every table carries `user_id` and
is protected by a policy that lets a signed-in person see only their own rows.

Only the `data` tables are here. `organizations`, `memberships` and `people` are
**not** created in your Supabase any more — they live on the organisation's server,
created by `server/schema/schema.sql`.

```sql
-- One helper, since all six data tables are shaped alike.
create or replace function agentix_setup(table_name text, extra_columns text default '')
returns void language plpgsql as $$
begin
  execute format($f$
    create table if not exists public.%I (
      id          text primary key,
      user_id     uuid not null references auth.users(id) on delete cascade,
      created_at  timestamptz not null,
      updated_at  timestamptz not null,
      deleted_at  timestamptz,
      %s
    );
    alter table public.%I enable row level security;

    drop policy if exists "own rows" on public.%I;
    create policy "own rows" on public.%I
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

    create index if not exists %I on public.%I (user_id, updated_at);
  $f$, table_name, extra_columns, table_name, table_name, table_name,
       table_name || '_user_updated_idx', table_name);
end $$;

select agentix_setup('tasks', $$
  title text not null,
  notes text,
  link text,
  status text not null,
  bucket_id text not null,
  assignee_ids jsonb not null default '[]'::jsonb,
  planned_for date not null,
  estimate_min integer,
  completed_at timestamptz,
  priority integer not null default 0,
  tags jsonb not null default '[]'::jsonb,
  -- The routine this task is a day's instance of, null for ordinary work. The id
  -- of such a task is derived from the routine and the day, so two devices
  -- generating the same morning write the same row instead of two.
  habit_id text
$$);

select agentix_setup('time_sessions', $$
  task_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  source text not null
$$);

select agentix_setup('notes', $$
  task_id text,
  content text not null,
  ai_summary text
$$);

select agentix_setup('buckets', $$
  name text not null,
  "order" integer not null,
  implies_status text not null,
  color_id text not null,
  is_default boolean not null default false
$$);

select agentix_setup('habits', $$
  title text not null,
  days_of_week jsonb not null default '[]'::jsonb,
  estimate_min integer,
  color_id text not null,
  archived_at timestamptz
$$);

select agentix_setup('habit_logs', $$
  habit_id text not null,
  day date not null,
  completed_at timestamptz not null
$$);
```

**3. Enable the sign-in methods** under Authentication → Providers. Agentix offers
three, and the app will show buttons for Google and Apple whether or not the
project has them switched on — an un-enabled provider fails at Supabase, not here.

- **Email.** On by default. Turn *Confirm email* off for a private project, or
  leave it on and expect the first sign-up to say "check your email".
- **Google.** Needs an OAuth client ID and secret from the Google Cloud console.
- **Apple.** Needs a Services ID, a key, and a team ID from the Apple Developer
  portal, which requires a paid membership. **This is not optional if Google is
  offered** — App Store review rejects an app that has one without the other.

**4. Allow the redirect back.** Under Authentication → URL Configuration, add every
origin the app is served from to *Redirect URLs*, including the path:

```
http://localhost:5173/
https://<user>.github.io/Agentix/
capacitor://localhost/
```

Supabase refuses any `redirect_to` that is not on this list, and the failure looks
like a successful sign-in that lands nowhere. The app asks to come back to
`origin + pathname`, which is why the trailing path matters on a project page.

**5. Organisations are not set up here any more.** `ORGS.sql.md` created them in
each person's Supabase, which was right when there was one backend and is wrong
now: an organisation is shared, and a table read by someone other than its author
does not belong in a project only its author controls. The live schema for those
three tables is `server/schema/schema.sql`, run on the organisation's own server.
`ORGS.sql.md` is kept for the policy reasoning it explains, not to be run.

**6. Reload.** The sign-in gate then offers all three routes. A device that has
never been connected asks for the project URL and anon key on that same screen,
because Settings is behind the gate.

## What has and has not been tested

The engine is covered end to end against an in-memory server, including the phase
gate: two devices editing offline, both reconnecting, nothing lost. Forty tests.

The transport is covered against a stubbed `fetch` — URLs, header placement,
snake_case mapping, upsert preference, and that no token ever reaches a message.

Auth is covered against a stubbed `fetch` too: that a password never reaches an
error message, that an unreachable server keeps the session instead of signing
someone out, and that the token fragment an OAuth redirect leaves in the URL is
stored and then scrubbed out of history.

**A real Supabase project has never been contacted.** The SQL above has not been
run, so the column types are reasoned rather than verified. Neither has a real
Google or Apple round trip — the redirect is built and parsed under test, but no
provider has ever answered it. Both are the first things to check once a project
exists.

**Organisations have never been exercised at all.** `core/org/` is pure logic and
is covered on its own terms — roles, seats, invitations, access — but no schema for
them has ever been run anywhere, and no invitation has ever been accepted by a
second account. That is the first thing to test once the identity server is
standing.

**The split itself is covered, the identity transport is absent.** `backends.test.ts`
pins the routing and `engine.split.test.ts` drives a pass across two in-memory
transports, so the fan-out is proven. What does not exist is the real transport for
the identity side, or any Keycloak round trip: nothing in this repo has ever spoken
to the org's server.
