# Deploying the web build

The web app ships to GitHub Pages. Android and iOS go to their own stores — see
`agentix-android/README.md` and `agentix-ios/README.md`.

Everything below is set up and verified locally. **Nothing has been pushed
anywhere yet**, because there is no remote.

## Once, to go live

**1. Create the repository and push.**

```bash
git remote add origin https://github.com/<you>/Agentix.git
git add .
git commit -m "Agentix v1"
git push -u origin main
```

**2. Turn Pages on.** Repository → Settings → Pages → Source: **GitHub Actions**.
Not "Deploy from a branch" — the workflow publishes an artifact directly.

**3. Push anything under `agentix-web/`.** The workflow runs on its own.

The site appears at `https://<you>.github.io/Agentix/`.

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
