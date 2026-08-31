# Agenda

Phase 2, basic. A day view over tasks, reading `plannedFor`.

## What it reads

- `tasks` for the selected day, and for the visible week (one range query, so the
  seven dots on the strip do not cost seven reads)
- `sessions` for the selected day's tasks, for the tracked-time total

## What it writes

- `Task.plannedFor` only — moving a task between days. It creates and deletes
  nothing; that is Task Manager's job.

A routine's card is the exception: it shows as "Routine" and offers no day arrows,
because its identity is the routine plus the day it belongs to. Tomorrow's instance
is made tomorrow.

## Files

```
agenda/
├── manifest.ts       id, name, icon, version
├── index.tsx         plugin assembly
├── Agenda.tsx        the entry component
├── components/       WeekStrip
└── logic/
    └── days.ts       calendar-day arithmetic — pure, no React, no Dexie
```

## The rule that keeps tasks on the right day

**Every day is a `'YYYY-MM-DD'` string in local time, never a UTC instant.**

`logic/days.ts` works on those strings end to end. Converting to a UTC datetime
anywhere along the way is how a task created at 23:30 lands on tomorrow, and how
tasks shift a day for anyone in a different timezone than the device that wrote
them. `todayKey` is tested at 00:30 and 23:30 specifically to hold that line.

A useful consequence: because the keys are zero-padded, they sort and compare
lexically. `isPast` is a string comparison, and it stays correct across year
boundaries without parsing anything.

## Not built yet

**Google Calendar import.** It needs a Google Cloud OAuth client ID, which is tied
to the owner's Google account and to the deployed domain. Nothing is stubbed for
it — there is no fake calendar section in the UI, because a placeholder that looks
like a feature is worse than an absent one. When credentials exist, the import is
additive: a read-only source rendered alongside tasks, writing nothing.

## Scope

Basic only, per the v1 plan. Advanced agenda is v2. Re-planning missed tasks in
bulk belongs to Reconsider (Phase 4) — this plugin moves one task at a time,
deliberately.
