# Connecting Agentix

Everything about signing in, projects, and the status light — in the order the
questions actually come up.

---

## The short version

**Agentix works with no account and no server.** Tasks, notes, habits and time all
live in your browser's own database on your own device. Open it and start.

**Signing in adds exactly two things:** syncing your work between your own
devices, and organisations you share with other people. Nothing else changes.

**Four ways in:** Google, Apple, GitHub, or an email address and password. All
four go to your own project — see below.

**To sign in, you need a Supabase project** — yours, not ours. That is the part
that surprises people, and the rest of this file explains why and what to do.

---

## Why it asks for a "project"

Agentix has no server. There is no Agentix account system, no database of ours
holding your tasks, and no company in the middle. That is the whole design, and it
is why your work cannot be read by anybody but you.

The consequence is the thing you ran into: **an account has to live somewhere, and
if it is not with us, it has to be with you.** Supabase is a hosted Postgres with
authentication attached, on a free tier that is generous for one person or a small
team. You create a project, Agentix points at it, and from then on:

- Google, Apple, GitHub and email sign-in all go to *your* project.
- Your synced rows sit in *your* database, under row-level security you can read.
- If you stop using Agentix, the data is still yours and still there.

**Without a project, sign-in has nowhere to go.** Every button — Google, Apple,
GitHub, email — ends up at the same endpoint on your project, so none of them can
work until that project exists. That is not a missing feature; it is a missing backend, and it is
deliberately yours to own.

---

## Setting one up

About ten minutes. Only the first step needs the browser.

### 1. Create the project

Go to [supabase.com](https://supabase.com), sign up, and press **New project**.
Pick a region near you and save the database password it gives you — you will not
need it for Agentix, but you will want it later.

Wait for the project to finish provisioning.

### 2. Copy two values

**Project Settings → API**. You need:

| Value | Looks like | Secret? |
|---|---|---|
| **Project URL** | `https://<ref>.supabase.co` | No |
| **anon public** key | a long JWT starting `eyJ…` | **No** |

Take the **anon public** key. Do **not** take the `service_role` key — it bypasses
every security rule and must never leave a server you control.

Both of these are meant to be published. The anon key ships inside every deployed
web bundle by design; row-level security is what actually protects the data. This
is the opposite of an AI provider key, which never goes near a build variable and
lives in a separate database on your device.

### 3. Give them to Agentix

Two ways, and they do the same thing:

**In the app** — Settings → Sync server → **Add a project**. Paste both, save.
Nothing to rebuild.

**In the build** — put them in `agentix-web/.env.local`:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Then restart `npm run dev`. Use this one when you want every device that loads
your build to arrive already pointed at the project.

### 4. Create the tables

In the Supabase dashboard, open the **SQL Editor** and run:

The block in [`src/core/sync/README.md`](src/core/sync/README.md) — the six tables
your work syncs through, each with a "you can only see your own rows" policy.

That is all of it. Organisations, memberships and the shared pool of people are
**not** created here: they are shared by definition, so they live on your
organisation's own server rather than in a project only you control. Nothing you
run in this dashboard sets them up.

> This has never been run against a real project. Expect to correct something the
> first time, and see the notes in that file for the parts most likely to need it.

### 5. Turn on the ways in

**Authentication → Providers**:

- **Email** is on by default. Turn *Confirm email* **off** if you want to create an
  account and use it immediately. Turn it **on** before you invite anyone to an
  organisation — the invitation claim trusts the address in the token, and an
  unconfirmed address is a claim about an inbox nobody checked.
- **GitHub** needs a free OAuth app: GitHub → Settings → Developer settings → OAuth
  Apps → New. The callback URL is the one Supabase shows you on the provider page.
  **This is the cheapest of the three** — no cloud console project, no paid
  membership — so it is usually the first social login that actually works.
- **Google** needs a free OAuth client ID from the Google Cloud console.
- **Apple** needs a Services ID, a key and a team ID from the Apple Developer
  portal, which requires the **$99/year** membership.

You can start with email alone, or email plus GitHub. But note: **the App Store
requires Sign in with Apple as soon as you offer any third-party login** — Google
and GitHub both count. That rule only binds the iOS build; the web build is free
to ship GitHub on its own.

### 6. Allow the redirect back

**Authentication → URL Configuration → Redirect URLs.** Add every origin the app is
served from, *including the path*:

```
http://localhost:5173/
https://<you>.github.io/Agentix/
capacitor://localhost/
```

Supabase silently refuses a `redirect_to` that is not on this list, and the failure
looks like a sign-in that succeeds and lands nowhere.

### 7. Reload

The setup panel is replaced by the providers you switched on — and only those. The
sign-in screen asks the project which externals are enabled and draws a button for
each, so a provider you have not configured cannot be pressed. The ones you left
off are named underneath, with where to turn them on.

If the project cannot be reached at that moment, every button is offered instead:
a failed question is not a reason to lock you out of your own project.

---

## More than one project

A device remembers every project it has been pointed at. Settings → Sync server
lists them, and switching is one click — no second trip to the dashboard for a
forty-character key.

- **Add a project** puts it in the list and makes it live.
- **Use this** switches to a saved one.
- The name is editable. It defaults to the project ref, which is a random string;
  call it "Production" and "Staging" instead.
- **Forget** removes it from *this device*. Nothing on the server changes, and if
  it was the live one, the device falls back to the next most recently used rather
  than disconnecting entirely.

Re-adding a project you already have updates that entry rather than making a
second one — which is what you want when you rotate an anon key.

**A project you were signed in to is still a project you were signed in to.**
Switching does not sign you out of the other one's session, but sync and
organisations follow whichever project is live.

---

## The status light

Next to the live project is a dot and a line of text. It answers one question: is
the project up, or is it me?

| Dot | Means |
|---|---|
| 🟢 **Reachable** | Answered, key accepted. Latency shown, and called out when slow. |
| 🟠 **Refused the key** | The project is up and the anon key is wrong. Re-copy it. |
| 🔴 **No answer** | Down, paused, or this device is offline. |
| ⚪ **Not checked** | No project selected. |

### What it actually sends

Deliberately as little as possible:

- **One `GET` to `/auth/v1/health`** — the authentication service's own liveness
  endpoint. The reply is about a hundred bytes: a name and a version.
- **It touches no table.** It cannot return anybody's data, and it costs nothing
  against your database.
- **Once a minute, and only while the app is in front of you.** A backgrounded tab
  polls nothing. It checks once when you come back, because that is when the
  reading is most likely stale.
- **It backs off while the project is down** — doubling up to ten minutes. A
  project that has been down an hour is not fixed by asking more often. One
  success resets it, so recovery is noticed on the next tick.
- **The key travels as a header, never in the URL**, and no error text ever quotes
  the request — a caught error can carry the headers, and the headers carry the
  key.

Free-tier Supabase projects **pause after a week of inactivity**. A red dot on a
project you have not touched in a while usually means exactly that: open the
dashboard and resume it.

---

## Accounts on this device

Settings → Accounts on this device lists the addresses that have signed in here,
and the sign-in screen offers them as shortcuts so nobody retypes an address for
the fiftieth time.

**Be clear on what this is.** It is a convenience list on your device:

- **Stored:** the address, which provider it came from, a name if the app has
  learned one, and when it was last used.
- **Not stored:** no password, no access token, no refresh token. An entry cannot
  sign anybody in — it can only fill in a field.
- **Not sent:** nothing here reaches us or anybody else. It is not analytics, and
  no count of it is reported anywhere. It lives in this browser and dies with it.

**Removing an account** forgets a name on this device. It does not sign anyone
out, delete anything on the server, or stop them signing in again. On a shared
machine, that is the button you want.

Accounts are remembered per project, so pointing the device at a different project
shows the people who can actually sign in there.

---

## Troubleshooting

**"Connect your project first" and I do not want that.**
That panel means no project is configured. There is no way around it *for signing
in* — but you do not have to sign in at all. Press Back and use the app; every
feature except sync and organisations works without an account.

**Sign-in seems to work, then lands on nothing.**
A redirect URL that is not on Supabase's allow-list. Step 6, and mind the trailing
path on a GitHub Pages project page.

**"Provider is not enabled."**
That provider is off in Supabase, not broken in Agentix: Authentication →
Providers, and Google in particular also needs an OAuth client ID and secret from
the Google Cloud console before the switch does anything.

You should not be able to reach this any more — the sign-in screen asks the
project what it has switched on and only draws those buttons. If you saw it, the
project answered differently at that moment: it was unreachable when the screen
loaded, so every button was offered rather than none, or the provider was turned
off in another tab. Reload and the buttons will agree with the project again.

**Apple refuses.**
Apple sign-in needs the paid developer membership. Google, GitHub and email do not.

**The dot is orange.**
The project answered and rejected the key. Almost always a truncated paste or a
`service_role` key where the anon key belongs.

**The dot is red and the project is fine in the dashboard.**
Check the URL for a typo, and check whether the free-tier project is paused.

**I want a clean slate.**
Settings → Your data → erase everything clears the local database. Forgetting the
project and the accounts is separate, in the two cards above — deliberately, so
clearing your work does not silently make you retype a key.

---

## Where this lives in the code

| Concern | File |
|---|---|
| Saved projects, switching, the migration from one stored config | `src/core/sync/projects.ts` |
| The heartbeat: what it sends, and how often | `src/core/sync/health.ts` |
| Scheduling it against tab visibility | `src/shell/useHealth.ts` |
| The device's account list | `src/core/auth/accounts.ts` |
| Which providers the project has on | `src/core/auth/providers.ts` |
| Sign-in itself, over GoTrue | `src/core/auth/index.ts` |
| Sync rules and the table SQL | `src/core/sync/README.md` |
| Which backend owns which table | `src/core/sync/backends.ts` |
| Organisation tables, on the org's own server | `server/schema/schema.sql` |
