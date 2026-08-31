# Agentix identity server

The self-hosted half of Agentix's two-backend design. It runs the **light
coordination layer** for one organisation — organisations, memberships, and the
shared pool of people — and issues the logins that reach it.

It never stores anything a person authors. Tasks, notes, time, the board and
habits all live in each person's **own** Supabase project. That split is a
deliberate liability boundary: authored content can only leak from the project
that holds it, which is the person's, not this server's. The routing that enforces
it in the app is `agentix-web/src/core/sync/backends.ts`; the half that enforces it
here is that no such table is ever created — see `schema/schema.sql`.

## What's in here

| File | What it is |
|---|---|
| `docker-compose.yml` | Postgres + PostgREST + Keycloak + Cloudflare Tunnel |
| `schema/schema.sql` | the three coordination tables, their RLS, and the JWT shims. Idempotent. |
| `.env.example` | the secrets the compose needs; copy to `.env` on the box |

## Running it

The full walkthrough — the Ubuntu box, the tunnel, the GitHub-driven deploy, and
the Keycloak realm — is the owner's private runbook, `SERVER-SETUP.md` at the repo
root (gitignored). In short:

```bash
cp server/.env.example server/.env   # then fill it in
docker compose -f server/docker-compose.yml up -d
docker compose -f server/docker-compose.yml exec -T postgres \
  psql -U agentix -d agentix -f /schema/schema.sql
```

## Why PostgREST and Keycloak, not the Supabase client

The app already speaks PostgREST's `/rest/v1/…` API for sync, and GoTrue/OIDC for
auth, over plain fetch — no `@supabase/supabase-js`. Self-hosting the identity side
is therefore the same two protocols pointed at this box instead of Supabase, which
is why the app's transport code is reused rather than rewritten. Keycloak issues
**asymmetric** tokens (Route A): this server signs with a private key, and every
member's own Supabase — and this server's own PostgREST — validate with the public
key. No secret is shared between them.

## The one integration to finish against a running Keycloak

PostgREST validates tokens with key material given in `PGRST_JWT_SECRET`; it does
not fetch a JWKS URL itself. So Keycloak's realm JWKS is copied into `JWKS_JSON` in
`.env` (the deploy workflow does this, or `.env.example` shows the one-line curl).
Rotate the realm signing key → redeploy so PostgREST picks up the new one.
