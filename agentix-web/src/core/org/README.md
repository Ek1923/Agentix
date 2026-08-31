# Organisations

Shared workspaces: a roster, three roles, seats, and per-person access to the
plugin menu.

## Optional, and quiet about it

Agentix without an organisation is exactly the app it was before this existed.
Nothing is seeded, `currentOrganization()` returns null, `useOrg().me` is null,
and every filter that reads it becomes the identity function. Creating one is a
deliberate act by a signed-in person, and it makes them its owner.

That matters more than it looks: the alternative — an implicit organisation of
one — would mean a personal database quietly becoming something with an
administrator, and every screen having to reason about a workspace nobody asked
for.

## Files

```
core/org/
├── permissions.ts   who may do what, to whom — pure
├── seats.ts         plans, seat accounting — pure
├── members.ts       the roster, invitations, plugin access — pure
└── README.md        this file
```

All three are pure and have no React and no Dexie, so they translate to Swift
line by line. The subscription to them lives in `shell/useOrg.ts`, which is a
hook and therefore cannot be here.

## Three roles, deliberately

| Role | Gets |
|---|---|
| **owner** | Everything, including the plan and deleting the organisation. |
| **admin** | Manages people and access. Not billing, not deletion. |
| **member** | Uses the app. Nothing administrative. |

Microsoft 365 ships around forty admin roles because it serves organisations with
a compliance officer and a licensing desk. The teams this is for have neither.
A fourth role would be one nobody can remember the meaning of.

## Every check returns a sentence

`permissions.ts` returns `{ ok: true }` or `{ ok: false, reason }`, never a bare
boolean. The UI's standing rule is that a disabled control has to say why it is
disabled, and a boolean cannot. Making each caller invent its own message is how
two screens end up disagreeing about the same rule.

The refusals are the specification. Read them and you have the model:

- You cannot reach above yourself — an admin cannot touch an owner.
- Peers cannot act on each other, **except owners**. Owners are the top, so
  refusing peer-on-peer there would mean a co-owner who has left can never be
  removed: nobody outranks them, and the one who could is gone.
- Everyone can act on their own row, which is what makes leaving possible without
  asking permission.
- An organisation must always keep one active owner. Every rule that could remove
  the last one — removing, suspending, demoting, including doing it to yourself —
  refuses. An organisation with no owner cannot be billed, renamed or recovered
  by anyone inside it, and there is no support desk to undo it.

## An invitation is a membership

There is no separate invitations table. An invitation is a `Membership` with
`status: 'invited'` and `userId: null`, addressed to an email. Two tables would
mean two places to keep in step and a window where both exist.

**Email is the identity throughout.** It is what the invitation is sent to, what
matches a person to their row when they first sign in, and what is displayed
before anyone has set a name. `userId` arrives at claim time and never replaces
it. `normaliseEmail` exists in exactly one place so that an invitation to
`Ada@Example.com ` and a sign-in as `ada@example.com` land on the same row — the
alternative is a seat held by a row nobody can reach.

Claiming happens in `App.tsx` on sign-in, not on the Organisation screen. The
point of being invited is that the app works, and the menu an admin granted has
to be right on the home screen — which is where an invited person actually lands.
It is idempotent, because every app open runs it.

## Seats

A seat is held by anyone still on the roster: invited, active **or suspended**.
Counting only active members would make the number drift from the invoice the
moment somebody was invited, and a seat count that disagrees with the bill is
worse than none. Suspension keeps the seat on purpose — an account you are still
paying for is the honest reading, and freeing it would silently change the bill.

Removing someone is a soft delete, so the seat frees and the history stays.

## Plugin access is a menu, not a lock

`allowedPluginIds` is `null` by default, meaning everything — including anything
installed later. That default matters: "all boxes ticked" and "everything" behave
differently the day a tenth plugin arrives.

**This is not a security boundary.** The plugin's code is already in the browser;
hiding a row protects nobody. It is here because "everyone sees the four tools
they use" is worth more to most teams than any restriction it implies. Real
enforcement would mean each plugin's queries carrying the check server-side.

`effectivePluginIds` drops unknown ids rather than keeping them, so a plugin that
was uninstalled does not linger in someone's allowance and silently return.

## Billing is not connected

`plan` and `seats` are real settings — the seat limit they set is the one
`canFillSeat` enforces, so lowering it genuinely stops the next invitation. What
they are not is a purchase. Nothing takes a payment, and the screen says so
rather than dressing an admin setting up as a checkout.

`BACKLOG.md` carries what connecting a real subscription needs.

## Not tested against a server

The logic here is covered on its own terms — 61 tests across roles, seats and the
roster — and the query layer is covered against a real IndexedDB. What has never
run is the other half: these three tables now live on the organisation's own
server, `server/schema/schema.sql` has never been executed against a running box,
and no invitation has ever been accepted by a second account. Their row-level
security is different in shape from the tables that came before, because a roster
nobody else can read is not a roster.
