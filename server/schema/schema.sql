-- Agentix identity server — the complete schema.
--
-- This is the ONLY schema that runs on the org's own server. It creates the light
-- coordination layer and nothing else: organisations, memberships, and the shared
-- pool of people. There is deliberately no table here for anything a person
-- authors — tasks, notes, time, the board, habits all live in each person's own
-- Supabase. What is not here cannot leak from here.
--
-- It is idempotent: run it as many times as you like. The deploy workflow does
-- exactly that on every push to server/**.
--
-- Two things make this different from the Supabase version of these tables:
--
--   1. There is no `auth.users` table. Keycloak owns users, in its own schema, so
--      `user_id` is a plain uuid here with no foreign key into an auth table.
--
--   2. `auth.uid()` and `auth.jwt()` are Supabase built-ins we do not have. PostgREST
--      exposes the verified JWT claims through `request.jwt.claims`; the shims below
--      rebuild those two functions on top of it, so the row-level-security policies
--      read identically to the ones in agentix-web/src/core/sync/ORGS.sql.md.

begin;

-- ── Roles PostgREST needs ──────────────────────────────────────────────────────
-- `authenticator` is the login PostgREST connects as; it can become nobody by
-- itself and SET ROLE to one of the two below based on the token's `role` claim.
-- Keycloak must stamp `"role": "authenticated"` into the token (a client mapper).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    -- Password is set from the compose env, not here — never hardcode it.
    create role authenticator noinherit login;
  end if;
end $$;

grant anon, authenticated to authenticator;
grant usage on schema public to anon, authenticated;

-- ── The auth shim: JWT claims, read the Supabase way ───────────────────────────
create schema if not exists auth;

-- The whole verified claim set, as json. `true` = do not error if unset (an
-- anonymous request has none), so a policy simply sees null and denies.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

-- Keycloak's `sub` is already a uuid string.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt()  to anon, authenticated;
grant execute on function auth.uid()  to anon, authenticated;

-- ── Tables ─────────────────────────────────────────────────────────────────────
-- Columns mirror the TypeScript types in agentix-web/src/core/db/types.ts so the
-- sync transport's snake_case encoding lands exactly. `user_id` is stamped onto
-- every pushed row by the transport; on the two shared tables it records who last
-- wrote the row and is NOT what the policies read.

create table if not exists public.organizations (
  id          text primary key,
  user_id     uuid,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  name        text not null,
  plan        text not null,
  seats       integer not null
);

create table if not exists public.memberships (
  id                 text primary key,
  org_id             text not null references public.organizations(id) on delete cascade,
  user_id            uuid,
  email              text not null,
  name               text,
  role               text not null,
  status             text not null,
  allowed_plugin_ids jsonb,
  invited_at         timestamptz not null,
  joined_at          timestamptz,
  created_at         timestamptz not null,
  updated_at         timestamptz not null,
  deleted_at         timestamptz
);

-- The shared pool: people a task can be assigned to, one identity across the org.
create table if not exists public.people (
  id          text primary key,
  user_id     uuid not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  name        text not null,
  color_id    text not null
);

create index if not exists memberships_org_updated_idx on public.memberships (org_id, updated_at);
create index if not exists memberships_email_idx       on public.memberships (lower(email));
create unique index if not exists memberships_one_per_org_idx
  on public.memberships (org_id, lower(email)) where deleted_at is null;
create index if not exists people_user_updated_idx on public.people (user_id, updated_at);

alter table public.organizations enable row level security;
alter table public.memberships  enable row level security;
alter table public.people       enable row level security;

grant select, insert, update on public.organizations to authenticated;
grant select, insert, update on public.memberships   to authenticated;
grant select, insert, update on public.people        to authenticated;

-- ── The recursion guard ────────────────────────────────────────────────────────
-- A policy on memberships that reads memberships would recurse and Postgres would
-- refuse it. These `security definer` helpers run as their owner, outside the
-- policy, which is the standard way out. `stable` so one statement evaluates them
-- once rather than per row.

create or replace function public.agentix_my_org_ids()
returns setof text
language sql
security definer
stable
set search_path = public
as $$
  select org_id
  from public.memberships
  where user_id = auth.uid()
    and status = 'active'
    and deleted_at is null
$$;

create or replace function public.agentix_my_role(target_org text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role
  from public.memberships
  where user_id = auth.uid()
    and org_id = target_org
    and status = 'active'
    and deleted_at is null
  limit 1
$$;

revoke execute on function public.agentix_my_org_ids()  from public;
revoke execute on function public.agentix_my_role(text) from public;
grant  execute on function public.agentix_my_org_ids()  to authenticated;
grant  execute on function public.agentix_my_role(text) to authenticated;

-- ── Policies: people (own rows) ────────────────────────────────────────────────
-- The pool is still authored by one person and belongs to them; sharing it as an
-- assignee list is a read the app performs, not a cross-account write.
drop policy if exists "own people" on public.people;
create policy "own people" on public.people
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Policies: organizations ────────────────────────────────────────────────────
drop policy if exists "members read their org" on public.organizations;
create policy "members read their org" on public.organizations
  for select using (id in (select public.agentix_my_org_ids()));

drop policy if exists "owner writes their org" on public.organizations;
create policy "owner writes their org" on public.organizations
  for update using (public.agentix_my_role(id) = 'owner')
           with check (public.agentix_my_role(id) = 'owner');

drop policy if exists "signed in can create an org" on public.organizations;
create policy "signed in can create an org" on public.organizations
  for insert with check (auth.uid() is not null);

-- ── Policies: memberships ──────────────────────────────────────────────────────
drop policy if exists "members read the roster" on public.memberships;
create policy "members read the roster" on public.memberships
  for select using (org_id in (select public.agentix_my_org_ids()));

drop policy if exists "admins write the roster" on public.memberships;
create policy "admins write the roster" on public.memberships
  for insert with check (public.agentix_my_role(org_id) in ('owner', 'admin'));

drop policy if exists "admins update the roster" on public.memberships;
create policy "admins update the roster" on public.memberships
  for update using (public.agentix_my_role(org_id) in ('owner', 'admin'))
           with check (public.agentix_my_role(org_id) in ('owner', 'admin'));

-- The one policy that keys on the verified email, not a role: it lets an invited
-- person attach their own account to a row addressed to their own address, and
-- nothing else. Requires Keycloak's email to be verified — an unconfirmed address
-- is a claim about an inbox nobody checked.
drop policy if exists "claim your own invitation" on public.memberships;
create policy "claim your own invitation" on public.memberships
  for update
  using (
    user_id is null
    and deleted_at is null
    and lower(email) = lower(auth.jwt() ->> 'email')
  )
  with check (
    user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email')
  );

-- No delete policy on any table, deliberately: the app soft-deletes, so removing
-- someone is an update that sets deleted_at. A hard delete never comes from a client.

commit;
