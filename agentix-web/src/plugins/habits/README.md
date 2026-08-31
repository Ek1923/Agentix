# Habits

Recurring routines with streaks.

## Why a habit is not a task with a repeat flag

A habit is a **rule**; a task is one occurrence. Keeping them apart means editing
the rule never rewrites history, and a missed day stays missed instead of
disappearing when the schedule changes.

Two tables: `habits` holds the rule, `habitLogs` holds one row per day kept. The
compound index `[habitId+day]` makes "was this done on that day" a lookup rather
than a scan, which the streak walk does a great deal of.

## The rule that matters most

**A habit due today but not yet done must not break the streak.**

Today is still open, so `streakFor` starts its walk at yesterday whenever today is
due and unticked. The streak breaks on the first *past* due day that was missed —
the only kind of miss that is final. Without this, every streak resets at 00:01.

Days the habit was never due are skipped entirely, so a Monday-and-Wednesday
routine is not punished for Tuesday.

## Routines on the board

A rule that only exists in its own plugin is a rule you have to remember to go and
look at. So each morning the day's due routines are materialised as ordinary tasks
— `core/habits.ts` decides which, `queries.materialiseRoutines()` writes them, and
the app calls it once on open.

The habit stays the rule. The card is one day of it, and it is a real `Task` with
`habitId` set, which is why it drags, times and counts like everything else on the
board.

Four things make that safe rather than a source of duplicates:

- **The card's id is derived**, `habit:<habitId>:<day>`, so two devices that both
  open the app on Tuesday write the same row rather than two cards for one chore.
  This is the one deliberate exception to ids being `crypto.randomUUID()`.
- **Ticking either place ticks both.** Finishing the card writes the day's log;
  ticking the routine here finishes the card. Two screens disagreeing about the
  same morning is how people stop trusting both.
- **A day that is over is not a job still owed.** Unkept cards are swept when the
  next day is materialised; a missed day stays missed, recorded by the absence of a
  log. Cards that were finished are never touched.
- **Pausing or deleting the routine clears only what is still open**, so the work
  that did get done stays in the record — and in the level earned from it.

Skipping today is deleting the card, and it is labelled that way. The routine comes
back tomorrow.

## Nothing is stored

Streaks, adherence and the day strip are all derived on read. A stored streak
would become a lie the moment the schedule changed.

## Files

```
habits/
├── manifest.ts
├── index.tsx
├── Habits.tsx
└── logic/
    └── streaks.ts   scheduling, streaks, adherence — pure
```
