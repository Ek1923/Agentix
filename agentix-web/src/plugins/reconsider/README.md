# Reconsider

Phase 4. Reads the last N days and suggests what to do about work that was
planned and never finished.

## What it reads

- `tasks` from the last 7, 14 or 30 days — the window is the user's choice
- `sessions` for those tasks, to know what was actually started

## What it writes

- `Task.plannedFor` — moving something to today or tomorrow
- Completion, via `ctx.db.setTaskDone`
- A soft delete, when something is dropped

It creates nothing and rewrites no titles. Moving a task forward keeps every
session already recorded against it.

## Files

```
reconsider/
├── manifest.ts       id, name, icon, version
├── index.tsx         plugin assembly
├── Reconsider.tsx    the entry component
├── components/       SuggestionCard
└── logic/
    └── suggestions.ts  classification, ranking, reasons — pure
```

## The rule this plugin exists to honour

**Every suggestion is derived from data that exists.**

A `Suggestion` carries the numbers it was built from — `daysOverdue`,
`trackedMin` — and `reasonFor` assembles the sentence from those fields alone. It
is therefore incapable of stating something untrue about a task. If a signal
cannot be measured, there is no suggestion for it.

Nothing is stored. The list is recomputed from live data on every render, so it
can never go stale or disagree with the board.

## How work is classified

| Kind | When | Why |
|---|---|---|
| **resume** | tracked time ≥ 2 minutes | Work already started outranks everything — the time is spent either way, and finishing is cheaper than starting over. |
| **drop** | never started, ≥ 14 days past its day | Offered for dropping, not for guilt. |
| **reschedule** | never started, more recent | Still likely to matter. |

Under two minutes of tracked time counts as a mis-click, not as work.

Ordering puts started work first, then fresh misses, then stale ones. Priority
breaks ties. The final tiebreak is the task id, so the list cannot reshuffle
between renders while someone is reading it.

## Two deliberate silences

- **Today's work is never mentioned.** A task planned for today has not been
  missed yet, and nagging about it would train the user to ignore this screen.
- **Finished work is never mentioned**, however late it was completed.

## Notes

"Tomorrow" rather than "today" is the default forward move on the secondary
button, because today is usually already full.

`setTaskDone` lives in `core/db/queries.ts` rather than here: more than one plugin
can finish a task, and status, `completedAt`, the board column and a running timer
drifting apart is exactly how a card ends up ticked in the wrong column with a
clock still running against it.
