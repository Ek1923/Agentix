# Organisations: the two tables that are not "own rows"

> **Superseded — do not run this against a Supabase project.**
> It was written when everything lived in one hosted project. Since 2026-08-30
> `organizations`, `memberships` and `people` live on the organisation's own
> server instead, and the schema that is actually deployed is
> `server/schema/schema.sql`. The reasoning below is why those tables were moved,
> so it is kept rather than deleted — a row read by someone other than its author
> does not belong in a project only its author controls.

It is separate from the `README.md` setup for a reason worth reading.

The other seven tables are private. Every row belongs to exactly one person, and
`auth.uid() = user_id` is the whole policy. Organisations are the opposite by
definition: a roster nobody else can read is not a roster. So these two tables
need policies that ask *"are you in this organisation, and what are you in it"*
rather than *"did you write this row"*.

> **None of this has been run.** No Supabase project has ever been contacted, so
> the column types and the policies below are reasoned, not verified. Expect to
> correct something on the first run — and see the recursion note, which is the
> part most likely to bite.

## Tables

`user_id` is present on both because the sync transport stamps it onto every row
it pushes (`encodeRow` in `supabase.ts`). On these two tables it records who last
wrote the row and nothing more — it is deliberately *not* what the policies read.

```sql
create table if not exists public.organizations (
  id          text primary key,
  user_id     uuid references auth.users(id) on delete set null,
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
  user_id            uuid references auth.users(id) on delete set null,
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

create index if not exists memberships_org_updated_idx on public.memberships (org_id, updated_at);
create index if not exists memberships_email_idx       on public.memberships (lower(email));
create unique index if not exists memberships_one_per_org_idx
  on public.memberships (org_id, lower(email)) where deleted_at is null;

alter table public.organizations enable row level security;
alter table public.memberships  enable row level security;
```

That unique index is the server-side half of `validateInvite`. The client checks
for a duplicate address before inviting; this makes it true even when two admins
invite the same person at the same moment.

## The recursion problem, and the two helpers that solve it

A policy on `memberships` that reads `memberships` to decide who you are will
recurse and Postgres will refuse it. The standard way out is a `security definer`
function, which runs as its owner and is therefore not itself subject to the
policy.

Both are `stable` so a single statement evaluates them once rather than per row.

```sql
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

revoke execute on function public.agentix_my_org_ids()      from public;
revoke execute on function public.agentix_my_role(text)     from public;
grant  execute on function public.agentix_my_org_ids()      to authenticated;
grant  execute on function public.agentix_my_role(text)     to authenticated;
```

## Policies

```sql
-- Anyone in the organisation can read it. Only an owner can change it, which is
-- what makes the plan and the seat count the owner's alone.
create policy "members read their org" on public.organizations
  for select using (id in (select public.agentix_my_org_ids()));

create policy "owner writes their org" on public.organizations
  for update using (public.agentix_my_role(id) = 'owner')
           with check (public.agentix_my_role(id) = 'owner');

-- Creating one is how you become its owner, so this cannot require a role you do
-- not have yet. The owner membership is written in the same transaction client
-- side; the unique index above is what stops a second org being smuggled in.
create policy "signed in can create an org" on public.organizations
  for insert with check (auth.uid() is not null);

-- The roster is readable by everyone in it. That is the whole point of it.
create policy "members read the roster" on public.memberships
  for select using (org_id in (select public.agentix_my_org_ids()));

create policy "admins write the roster" on public.memberships
  for insert with check (public.agentix_my_role(org_id) in ('owner', 'admin'));

create policy "admins update the roster" on public.memberships
  for update using (public.agentix_my_role(org_id) in ('owner', 'admin'))
           with check (public.agentix_my_role(org_id) in ('owner', 'admin'));
```

## Claiming an invitation

An invitation is a row with `user_id null` and the address it was sent to. When
that person signs in, something has to attach their account to it — and they are
not an admin yet, so none of the policies above let them.

This is the one policy that keys on the JWT's email rather than on a role:

```sql
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
```

The `with check` half is what keeps it safe: it lets someone fill in *their own*
id on a row addressed to *their own* verified address, and nothing else. It
cannot be used to change a role, because a row where `role` was raised would
still have to satisfy the admin policy to be written.

**Confirm email must be on** for this to mean anything. The claim trusts the
address in the token, and an unconfirmed address is a claim about an inbox nobody
checked. `README.md` step 3 says you may turn confirmation off for a private
project — do not, once an organisation exists.

## What this does not do

**Deletion.** There is no delete policy on either table, deliberately: the app
soft-deletes, so removing someone is an `update` that sets `deleted_at`, and a
hard `delete` should never come from a client.

**Enforcement of plugin access.** `allowed_plugin_ids` is stored here and read by
the client to decide what to show. It is not a security boundary — the plugin
code is already in the browser. Making it one means the plugin's data queries
carry the check server-side, which is a larger change than this file.

**Billing.** Nothing here charges anyone. `plan` and `seats` are the record of
what was agreed, not the result of a payment. See `BACKLOG.md`.
