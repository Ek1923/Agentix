# Workload

An extra plugin, beyond the five in the v1 brief. Forward-looking capacity: is
what is planned actually deliverable?

## Scope

Backtest looks back at accuracy. Flow looks at how work moves. **Workload looks
forward** — it is the only one that reads days that have not happened yet.

## What it reads

- `tasks` from today through the horizon (3, 7 or 14 days)
- `sessions` from the last 30 days, to measure capacity
- `people`, for per-person load

It writes nothing.

## The rule this plugin exists to honour

**Capacity is measured, never assumed.**

There is no eight-hour default anywhere in this code. Until at least three days
have real tracked time on them, the screen says it does not know and grades
nothing. An invented capacity would produce invented warnings, and a warning you
cannot trust is worse than no warning.

Two more measurement decisions follow from it:

- **Untracked days are excluded, not counted as zero.** A weekend is an absence of
  evidence, not evidence that you can do no work. Including it would halve every
  figure.
- **Median, not mean.** One heroic day should not become the expectation.

## What it shows

- **Your measured day** — median tracked minutes on a working day, with the sample
  size and your best day for context.
- **Day by day** — planned minutes per day, as a share of a proven day. Days with
  nothing on them stay visible as room rather than disappearing.
- **Unestimated work** — counted and flagged per day. What cannot be weighed still
  has to be shown, or a plan looks lighter than it is.
- **Overcommitment** — days planned past a typical day of yours. Phrased as
  arithmetic, not as a rule.
- **On each plate** — open work per tagged person. A task tagged with three people
  counts for each: this answers "what is on your plate", not "how is the total
  divided".
