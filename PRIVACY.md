# Privacy

**Agentix** · Last updated 30 August 2026

Agentix runs entirely on your device. This document describes what that means in
practice, and it is short because there is not much to describe.

Agentix now requires an account to open. That account is **not with us** — it lives
in a Supabase project you own and point the app at. See *Signing in*, below.

---

## Your API key

**Your API key is stored only in your browser, on this device.**

- It is never sent to us. We could not receive it if we wanted to.
- **We operate no server.** There is no backend, no database, and no log on our
  side that could contain your key. Agentix is a static site: your browser
  downloads it once and then runs it locally.
- The only place your key is ever sent is the AI provider you chose — Anthropic or
  OpenAI — directly from your browser to their API, over HTTPS. That request is
  what makes the feature work, and it goes nowhere else on the way.
- Deleting a key in Settings removes it from your browser's storage immediately.

Your key is held in your browser's IndexedDB storage. That is less protected than a
phone's keychain: anyone who can use this device, or who can read this browser's
profile, can read the key. Agentix says this plainly in the app, under the key
field, rather than burying it here.

**We recommend setting a spend limit** on your Anthropic or OpenAI account. It is
the single most effective way to cap your exposure if a key is ever compromised —
by any route, not just this one.

## Your tasks, notes, and time sessions

Stored on this device only, in your browser's local storage. They are not uploaded,
not backed up by us, and not visible to us. Clearing your browser's site data for
Agentix deletes them permanently, and we cannot recover them for you.

## Signing in

Agentix asks you to sign in before it will open, and it ships with no server of
ours to sign in to. The account lives in **your own** Supabase project, which you
point the app at either in Settings or in your own build.

You can reach that account four ways:

- **Email and password**, created in the app and held by your project.
- **Google**, which sends you to Google to approve it.
- **Apple**, which sends you to Apple to approve it.
- **GitHub**, which sends you to GitHub to approve it.

For the three social routes the browser leaves Agentix, you approve the sign-in on
their page, and they send you back with a token. What they see is a sign-in request
from your project — they do not see your tasks, your notes, or your API keys. Their
own privacy policies govern that step:

- [Google privacy policy](https://policies.google.com/privacy)
- [Apple privacy policy](https://www.apple.com/legal/privacy/)
- [GitHub privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)

**You need to sign in once, not every time.** After the first sign-in the session
is kept on the device and Agentix opens offline — on a plane, in a tunnel, with the
server down. You are signed out only when you ask to be, or when your project
actually rejects the session.

## Accounts remembered on this device

So nobody retypes an address they have used fifty times, this device keeps a list
of the accounts that have signed in on it, and the sign-in screen offers them.

- **Stored:** the address, which of the four routes it came from, a display name if
  the app has learned one, which project it belongs to, and when it was last used.
- **Not stored:** no password, no access token, no refresh token. An entry cannot
  sign anybody in — it can only fill in a field.
- **Not sent:** it stays in this browser. It is not analytics, and no count of it
  reaches us or anybody else.

Settings → Accounts on this device removes an entry. That forgets a name here; it
does not sign anyone out, delete anything on your project, or stop them signing in
again. On a shared machine, that is the button you want.

## Checking whether your project is up

When a project is connected, Agentix asks it whether it is alive, so a failure to
sync can be told apart from a server that is down.

- It sends **one `GET` to your project's own `/auth/v1/health`** — nowhere else,
  and never to us.
- **It touches no table.** It cannot return anybody's data, and it costs nothing
  against your database.
- **Once a minute, and only while the app is in front of you.** A backgrounded tab
  sends nothing, and the interval stretches to ten minutes while the project is
  down.

## What sync sends

When your project is connected:

- Your tasks, notes, sessions, columns and routines are sent to **your** project,
  under **your** account. We have no access to it.
- **If you are part of an organisation**, one more server is involved and it holds
  deliberately little: the organisation, who is on its roster, and the shared pool
  of people a task can be assigned to. Names and labels — never a task, a note, a
  timer or anything you wrote. That split is the reason it exists: the content
  stays in a project you control, so a leak is yours to contain rather than
  somebody else's to explain. Your organisation runs that server, and its address
  is one you or they set; it is never built into the app.
- **Your API keys are never synced.** Not as an option, not as a setting. They
  live in a separate database on the device that entered them.
- **A running timer is never sent** until you stop it, so two devices cannot end
  up claiming the same stretch of work.
- Deletes sync as deletes. Nothing is quietly resurrected on another device.

Sign out and everything stays on the device. Nothing is removed — but you will
need to sign in again before the app will open.

## What we collect

Nothing.

No analytics, no tracking pixels, no cookies, no crash reporting, and no account
with us — the only account involved is the one on your own Supabase project.
Agentix makes no network request except to the AI provider you configured, the sync
server you named — including the once-a-minute check that it is up — your
organisation's server if you belong to one, and, only if you choose that route to
sign in, Google, Apple or GitHub.

## Hosting

The web version is served from GitHub Pages. Like any web host, GitHub receives
your IP address and browser user-agent when you load the page — this is ordinary
web-server behaviour and is governed by
[GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
We receive nothing from it.

## Third parties

The AI provider you choose, and only when a feature you triggered needs it. Your
prompt and your key go to them; their privacy policy and data-retention terms apply
to that request. We are not a party to it.

- [Anthropic privacy policy](https://www.anthropic.com/legal/privacy)
- [OpenAI privacy policy](https://openai.com/policies/privacy-policy)

And Google, Apple or GitHub, only if you pick one of them to sign in with. See
*Signing in*, above.

## Changes

Material changes will be reflected here with a new date at the top. The version of
this document that applies to you is the one shipped with the version of Agentix
you are running.

## Contact

Agentix is built by Ege Baykal. Questions about this document can be raised as an
issue on the project repository.
