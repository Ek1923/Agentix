# Task Manager

Phase 1. Task CRUD for today, plus the clock-in / clock-out timer.

Four other plugins read the data this one writes, so its behaviour is the schema's
reference implementation.

## What it reads

- `tasks` where `plannedFor` is today and `deletedAt` is null
- `sessions` belonging to those tasks

## What it writes

- **Tasks** — title, estimate in minutes, priority, status
- **TimeSessions** — one row per clock-in, closed on clock-out

## Routine cards

A card with `habitId` set is today's instance of a routine from the Habits plugin.
It is an ordinary task in every way that matters here — it drags, it times, it
counts — with two differences: finishing it also records the routine as kept that
day, and it cannot be moved to another day, because its identity is the routine
plus the day. It is marked "Routine" on the card, and its delete action says "Skip
today", which is what it does: the routine is back tomorrow.

## Files

```
task-manager/
├── manifest.ts       id, name, icon, version
├── index.tsx         plugin assembly — manifest + component, nothing else
├── TaskManager.tsx   the entry component
├── components/       TaskComposer, TaskRow
├── useTicker.ts      re-render on an interval so a running clock advances
└── logic/            pure functions — no React, no Dexie
    ├── time.ts       durations, formatting, estimate delta
    └── tasks.ts      ordering, grouping, input parsing
```

`logic/` is the specification for the Swift build. Translate those two files line
by line rather than re-inventing the behaviour; their tests are the acceptance
criteria and should be ported too.

## The rule that makes the timer survive a closed tab

**Elapsed time is always derived from `startedAt` and the current clock. It is
never accumulated into a counter.**

A counter stops when the tab closes. Two timestamps do not. A running timer is
just a `TimeSession` row with `endedAt: null`, so reopening the app finds the row
and recomputes elapsed time from the moment work actually started — including the
hours the tab was shut.

This is why nothing in `logic/time.ts` holds state, and why `Task` must never grow
a `timeSpent` field.

## Rules it enforces

- **One running session, ever.** `startSession` closes any open session inside a
  transaction, so two tabs cannot both think they are tracking.
- **A finished task stops accruing time.** Ticking a running task done closes its
  clock, and done tasks offer no timer.
- **Deletes are soft.** Deleting a task closes its timer first, then sets
  `deletedAt`.
- **No estimate is not an estimate of zero.** `estimateDeltaMin` returns null
  rather than scoring an unestimated task as massively over.

## Scope

Today only. Day navigation belongs to Agenda (Phase 2), and re-planning missed
tasks to Reconsider (Phase 4). A task created here always lands on today's local
calendar date.
