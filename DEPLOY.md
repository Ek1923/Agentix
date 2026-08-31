# Deploying the web build

The web app ships to GitHub Pages. Android and iOS go to their own stores — see
`agentix-android/README.md` and `agentix-ios/README.md`.

**This is live.** The repository is `github.com/Ek1923/Agentix` (public) and the
site is served at **https://ek1923.github.io/Agentix/**. Pages is set to build from
GitHub Actions, and the first run — verify, build, deploy — passed without a fix.

## Publishing a change

Push anything under `agentix-web/` to `main`. The workflow runs on its own: it
typechecks, lints, runs the whole suite and scans for secrets before it builds, so
a change that fails its own tests never becomes the live site.

Nothing else is needed. If you ever recreate the repository from scratch, the
setup is: create it empty, push `main`, then Settings → Pages → Source **GitHub
Actions** (not "Deploy from a branch" — the workflow publishes an artifact
directly).

## Adding your domain

Create `agentix-web/public/CNAME` containing nothing but the hostname:

```
agentix.example.com
```

Then point a `CNAME` DNS record at `<you>.github.io`, and set the domain under
Settings → Pages.

That one file is the whole switch. The workflow looks for it and builds for the
site root instead of `/<repo>/`, so there is no second place to remember.

## What the workflow does

Three jobs, in order, and the middle one only runs if the first passes.

**verify** — typecheck, lint, the full test suite, and the secret scan. A build
that fails its own tests never becomes the live site. The secret scan is there to
keep the promise `PRIVACY.md` makes: no key-shaped literal ever ships.

**build** — works out the base path from whether `public/CNAME` exists, then
builds and uploads the result.

**deploy** — publishes it.

## Why the base path needs deciding at build time

A project page serves the app from `https://<you>.github.io/Agentix/`, so every
asset URL has to carry that prefix. A custom domain serves from `/`, and the same
prefix would break it. Vite bakes this in at build time, so it cannot be decided
later — hence `AGENTIX_BASE`, and hence the CNAME check that sets it.

Verified locally at both paths: assets, stylesheet and favicon all resolve when
the build is served from a subdirectory.

## Routing survives it, by design

Routes are hashes — `#/settings`, `#/plugin/backtest`. GitHub Pages does not
rewrite unknown paths to `index.html`, so a path-based route would 404 on refresh
or on a shared link. A hash never leaves the server's view of the URL.

The same property is why the Capacitor WebView works. One decision, three
platforms.

## Supabase, if and when

Sync is optional and the site works fully without it. To enable it, add two
**repository variables** (Settings → Secrets and variables → Actions → Variables):

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Variables, not secrets — both values are publishable by design. The anon key is
meant to ship in the bundle, and row-level security is what actually protects the
data. Putting them in Secrets would work too, but would imply they are sensitive,
and that misunderstanding is how someone later assumes the AI keys can travel the
same way. They cannot: those never touch a build variable.

Without them the build still succeeds and the Account panel says sync is not
configured.

## What has not been tested

The workflow has never run. It is written against the current Actions APIs but
the first push is the first real execution — expect to fix something small.

The most likely candidates: the Node version, and Pages needing to be switched to
"GitHub Actions" before the first deploy can succeed.
