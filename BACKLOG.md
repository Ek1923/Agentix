# Backlog

Things deliberately deferred, with enough context to pick them up cold.

---

## Architecture note (2026-08-31)

Agentix moved to a **two-backend split**: a self-hosted identity server on the
owner's Ubuntu box (organisations, memberships, the people pool — see `server/`
and the private `SERVER-SETUP.md`) plus each user's own Supabase for authored
content. This supersedes several Supabase items below, which were written for the
single hosted-Supabase model. Route A (asymmetric JWTs via Keycloak) is the
chosen trust model. The locked "no self-hosting" line lived in
`agentix-v1-structure.md` §1 and has been struck through and superseded there;
`AGENTIX-CLAUDE.md` now opens with where the project actually landed, and
`core/sync/README.md`, `CONNECTING.md` and `core/org/README.md` describe the split
rather than the single hosted project. `core/sync/ORGS.sql.md` is marked superseded
— the live schema for the identity tables is `server/schema/schema.sql`.

**Accounts are gated off** (`agentix-web/src/core/features.ts`, `features.accounts
= false`) until that server is standing: signing in, sync, organisations and the
shared pool are hidden rather than shown broken. Flip the flag to `true` the day
the server answers, and wire the identity transport (still to build) alongside it.

The **level/rank system** landed personal-only: `core/rank.ts` scores completed
work into levels, tiers and streaks, surfaced on Profile (`ui/components/RankCard`)
and as a corner pill on the profile bar. It is live rather than a figure you go and
look up — `core/db/changes.ts` announces every write, `shell/useRank.ts` holds one
shared snapshot for the whole app, and crossing a level raises a moment
(`ui/components/LevelUpToast`) wherever you happen to be, with the `success`
feedback event iOS maps to a haptic. A level earned with the tab closed is
delivered on next open; the last level anybody was shown is remembered in
`localStorage` under `agentix.rank.seenLevel`.

The **team leaderboard** half needs the identity server — it is shown as a locked
teaser until `features.accounts` is on.

**Routines now reach the board** (2026-08-31). A habit is still a rule; each day it
is due it also materialises as an ordinary task whose id is derived from the
routine and the day (`core/habits.ts`, `queries.materialiseRoutines()`, called once
on open). Ticking the card records the day; ticking the routine ticks the card.
Unkept cards are swept when their day is over, and pausing or deleting a routine
clears only what is still open. Routine cards are excluded from the trash — the app
clears them constantly, and the routine is the thing worth restoring. What is *not*
built: routines only materialise for today, so a future day in Agenda shows nothing
until that day arrives.

One interaction worth knowing: a routine's card is an ordinary task, so keeping a
routine now earns XP and counts toward the level. That is deliberate — discipline
is what the rank is about — but it is the reason a day of routines moves the number
more than it used to.

---

## The identity client is built, the server is not

**Shipped 2026-08-31.** The app side of the organisation's server is done and
tested against a stubbed `fetch`:

- `core/auth/keycloak.ts` — authorization code with **PKCE**, an S256 challenge
  that never falls back to `plain`, a `state` check that refuses a code this
  browser did not ask for, the query scrubbed out of history before anything else
  happens, refresh that signs out on a rejection but *not* on an unreachable
  server, and a sign-out that clears this device before it asks Keycloak to end the
  session there.
- `core/sync/identity.ts` — the PostgREST transport for the box, and where the box
  is (`VITE_IDENTITY_URL`, or a device override for one being stood up). It refuses
  plain http except on localhost, and throws rather than carrying a table that
  belongs to the other backend.
- `core/sync/postgrest.ts` — the requests both backends share, extracted from the
  Supabase transport rather than copied.
- `core/sync/split.ts` — which transports a device can use: **both**, **data-only**
  when there is no organisation server, or **none**. An organisation server without
  a personal project is deliberately *not* syncable: the roster would sync while
  every task stayed queued behind a backend that is not there.

**What is left, in order:**

1. **Stand the box up** — `SERVER-SETUP.md`. Nothing in this repo has ever spoken
   to a real Keycloak or a real PostgREST.
2. **Set `VITE_IDENTITY_URL`** as a repository variable (Settings → Secrets and
   variables → Actions → Variables), and each member's Supabase to trust the realm
   as a third-party issuer.
3. **Flip `features.accounts` to `true`** in `core/features.ts`.
4. **There is still no settings field for the server URL.** It comes from the build
   variable, or from `localStorage` under `agentix-identity-url` for testing. A
   field belongs next to the Supabase project one in the Account card, and is worth
   adding the day a second person has to point their browser at the box.

---

## Needs the owner

### Point the domain at it
**Done, as of 2026-08-31: the repo is `github.com/Ek1923/Agentix` and the site is
live at https://ek1923.github.io/Agentix/.** The first workflow run passed on its
own — verify, build and deploy — so the pipeline no longer counts as untested.

What is left is the custom domain. It is one file plus one DNS record:

1. `agentix-web/public/CNAME` containing nothing but the hostname. The workflow
   reads that file to decide the base path, so this is also what switches the
   build from `/Agentix/` to `/`.
2. A `CNAME` record at the DNS provider pointing that hostname at
   `ek1923.github.io`. Behind Cloudflare, the proxy has to be off.
3. Settings → Pages → Custom domain, then **Enforce HTTPS** once the certificate
   has been issued, which takes a few minutes.

### Manual test: a real AI request
**From Phase 3.** Every AI path is covered by tests, but with a mocked `fetch` — a
real request to Anthropic or OpenAI has never actually run.

To do it: Settings → API keys → paste a key → **Test connection**, then Note Taker
→ write a note of a few sentences → **Summarise**.

What to watch for, since these only fail against the real API:
- CORS. Anthropic needs the `anthropic-dangerous-direct-browser-access` header,
  which is set in `providers/anthropic.ts` — but only a real call proves it.
- Model ids. The list in `providers/anthropic.ts` and `providers/openai.ts` was
  written from memory and never validated against a live account.
- Response shape. The parsers assume documented shapes; a live reply confirms it.

### Google Calendar import
**The other half of Phase 2.** Needs a Google Cloud OAuth client ID tied to the
owner's Google account and the deployed domain. Nothing is stubbed — there is no
fake calendar section, deliberately.

To unblock: create a Google Cloud project, enable the Calendar API, create an
OAuth 2.0 Client ID for a Web application, then hand over the client ID and the
eventual domain. The client ID is not a secret; it ships in the bundle by design.

### Supabase project
**This is now the blocker for opening the app at all.** Signing in is required as
of 2026-08-29, and there is nothing to sign in to until a project exists. The
engine, the transport, auth, the gate, the saved-project list and the status light
are all built; nothing has ever contacted a real project.

**`agentix-web/CONNECTING.md` is the walkthrough** — why the project has to be
yours, each step with the failure it prevents, and the troubleshooting. The short
version:

1. Create a Supabase project. Copy the **Project URL** and the **anon public** key;
   never the `service_role` key.
2. Give them to the app: Settings → Sync server → **Add a project**, which needs no
   rebuild, or `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in
   `agentix-web/.env.local`, which points every device loading that build at it.
   The device remembers every project it has been given, so a staging project is
   one click away rather than another trip to the dashboard for a key.
3. Run the SQL in `agentix-web/src/core/sync/README.md` — it creates the six data
   tables with row-level security so a signed-in person sees only their own rows.
   Organisations, memberships and the pool are not created here any more: they
   live on the org's own server (`server/schema/schema.sql`).
4. Enable providers under Authentication → Providers. Email needs nothing.
   **GitHub is the cheapest social login that works** — a free OAuth app, no cloud
   console, no membership — so it is the one to try first. Google needs a free
   client ID; Apple needs the paid membership, below.
5. Add every serving origin to *Redirect URLs* under URL Configuration — localhost,
   the Pages URL **including `/Agentix/`**, and `capacitor://localhost/`. A missing
   entry looks like a sign-in that succeeds and lands nowhere.

Then read the dot beside the live project: green is answered and the key accepted,
orange is up but refusing the key, red is no answer at all. It polls
`/auth/v1/health` once a minute while the tab is in front of you, touches no table,
and backs off while the project is down.

Both values are publishable by design, unlike an AI key. **The column types in
that SQL are reasoned, not verified** — running it is the first real test.

### Sign in with Apple needs the paid membership
**Blocking, and it costs money.** Google needs only a free Cloud OAuth client and
GitHub only a free OAuth app. Apple is the exception: a Services ID, a key and a
team ID all come from the Apple Developer portal, which needs the $99/year
membership.

This is not a choice between them. App Store review rejects an app offering *any*
third-party login without also offering Apple — Google and GitHub each trigger it
on their own — and the gate ships all three buttons. Shipping to the App Store
means paying for this first; until then the Apple button fails at Supabase with
"provider is not enabled". The web build is under no such rule and can ship GitHub
on its own.

### A real OAuth round trip
**Never performed.** The authorize URL is built under test and the returning token
fragment is parsed, stored and scrubbed under test, but no provider has ever
answered one. What only a live run can confirm:

- that Supabase accepts the `redirect_to` the app sends, on each serving origin
- that the fragment arrives before the hash router reads the URL, in a real browser
  rather than jsdom
- that the redirect survives the Capacitor WebView, where the origin is
  `capacitor://localhost` and not an https page

### Billing: nothing charges anyone yet
**The organisation layer is built and the seat limit is enforced, but no money
moves.** `plan` and `seats` are real settings — lowering the seat count genuinely
stops the next invitation — they are simply not connected to a subscription. The
Plan panel says so on screen rather than pretending otherwise.

To make "buy Enterprise" mean something:
1. A payment provider. Stripe Checkout plus the customer portal is the least
   custom work: it owns the card form, the VAT handling and the dunning emails,
   none of which belong in this codebase.
2. A webhook endpoint, which is the first server-side code this project would
   own. Supabase Edge Functions is the natural home since the database is already
   there. It has to be the *only* writer of `organizations.plan` and `.seats` —
   a client that can raise its own seat count has no billing at all, which means
   the policy on the org server (`server/schema/schema.sql`) has to stop allowing
   the owner to write those two columns and let a privileged role do it instead.
3. Prices per plan, and a decision on annual vs monthly.

Until then the honest framing is the one on screen: this records what your plan
is and enforces it inside the app.

### Organisations have never met a server
**From the organisation work.** `core/org/` is covered by 61 tests and the query
layer by 18 more, all against a real IndexedDB. None of it has been near Supabase.

`server/schema/schema.sql` has the tables and policies and has never been run
against a live box. Three things in it are the ones to check first, because they
are the ones that differ from the data tables that came before:

- **The recursion guard.** A policy on `memberships` that reads `memberships`
  will be refused by Postgres. Two `security definer` helpers work around it; that
  pattern is the most likely thing to need correcting.
- **The claim policy**, which keys on the JWT's email rather than on a role. It is
  the only way an invited person can attach their account before they have any
  permissions. It also means **email confirmation must be on** — the claim trusts
  the address in the token.
- **Shared reads.** These two tables are the first whose rows are meant to be read
  by someone other than their author. Everything else in the app is `auth.uid() =
  user_id`, and a roster under that policy is invisible to everyone but whoever
  wrote it.

Then the real test: invite an address from one account, sign in as it on another
browser, and check the roster and the menu agree on both.

### The "pool"
Shared people, rather than the device-local list Task Manager has now. The owner
said this is advanced and would explain it later. The current `Person` records are
the foundation: names become ids when a real pool exists.

Organisations changed the shape of this. A `Membership` is already a shared person
with an identity, a role and an address — so the pool is most likely memberships
being selectable as assignees, rather than a third kind of person alongside
`Person` and `Membership`.

---

## Decided, not yet done

### Android: build and run it on a device
**The port is scaffolded and syncs correctly, but nothing has been compiled.** This
machine has a JDK and no Android SDK.

Install Android Studio, then from `agentix-android/`:
```
npm install && npm run sync && npm run open
```

Only a device can show these, so check them first:
- the hardware back button walking home from a plugin, and closing the app from home
- safe areas on a device with a notch and a gesture bar
- the board's horizontal scroll and card drag under touch rather than a mouse
- IndexedDB surviving the app being backgrounded and killed

### iOS: everything that needs a Mac
**Parked by decision on 2026-08-29.** The Capacitor shell in `agentix-ios/` is
complete and syncs correctly; haptics are wired through to the real iOS
generators. Nothing past that point can happen on Windows — Xcode is macOS-only.

Waiting on a Mac:
1. Enrol in the Apple Developer Program ($99/year). Start this early; it is the
   only step with an unavoidable wait.
2. `npm install && npm run sync && npm run open` from `agentix-ios/`.
3. Signing, archive, upload — the full sequence is in `agentix-ios/README.md`.
4. Internal TestFlight testers need no review. External testers need Beta App
   Review, usually a day.

Four things that will bite at App Store review are written out in that README:
Sign in with Apple (becomes mandatory the moment Google sign-in is added), privacy
labels, export compliance, and the "where is the functionality" rejection that
hits apps looking empty without configuration.

### iOS, the Swift rewrite
Still the destination the brief locks in, and still not started — deliberately.
Ship the Capacitor build to testers first, so the rewrite answers a question
rather than guessing at one.

The specification is already isolated and has no React, no Dexie and no network:
`core/dates.ts`, `core/stats.ts`, `core/sync/merge.ts`, all three files in
`core/org/`, and every plugin's `logic/` folder. Their tests port with them as the acceptance criteria.
`ui/tokens.ts`, `ui/avatars.ts` and `ui/theme.ts` are plain data meant to be read
across.

`ui/feedback.ts` is no longer only a seam — it now calls the real generators
through Capacitor, so the Swift build has a working reference for what each event
should feel like.

---

## Scope drift to keep an eye on

The v1 brief locks the plugin list to five: Task Manager, Agenda, Note Taker,
Reconsider, Backtest. Nine now ship. **Flow** and **Workload** were added at the
owner's request for business data analysis; **Habits** and **Tags** followed.

The three that read the same data were kept deliberately distinct, because that is
where the overlap would otherwise creep in:

- Backtest: how accurate were you (estimate vs actual, completion rate, focus time)
- Flow: how does work move (lead time, cycle time, throughput, stalls)
- Workload: can you take on what is planned (measured capacity vs commitments)

`agentix-v1-structure.md` §9 has been updated to say nine.

---

## Nice to have

- **Bundle size.** Done, and worth knowing where it landed. First paint now
  fetches 505 kB / 163 kB gzipped across two chunks, down from a single 644 kB /
  195 kB chunk. Every plugin, plus Settings, Profile and Theme, loads on demand
  from its own chunk instead of riding along in the entry bundle.

  What is left in the entry chunk is React, Framer Motion and Dexie — all needed
  before the first screen paints, so splitting them further moves bytes without
  making anything arrive sooner. The next real win would be dropping a dependency,
  not re-slicing these.
- **Drag and drop is untested.** jsdom cannot do native DnD, so every card move is
  covered through the keyboard path instead. Needs a real browser test runner.
