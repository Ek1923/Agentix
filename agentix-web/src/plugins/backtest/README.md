# Backtest

Phase 5, the last of the five v1 plugins. What actually happened, over a window
you pick.

## What it reads

`tasks` planned in the last 30 days and `sessions` started in the same period.
It writes nothing except the window choice, which lives in settings.

## What it reports

- **Completion rate** — done / planned, for the window and per day
- **Focus time** — tracked minutes per day, and a typical day
- **Estimate accuracy** — estimate versus summed session minutes
- **Clock-in / clock-out** — first start and last stop each day
- **Longest unbroken session**

## Three rules

**Nothing derived is stored.** Every figure is computed from Task and TimeSession
on demand. A stored derivative goes stale the moment a task is edited, and a stale
number that looks current is worse than no number.

**Fetched once, sliced in memory.** Both queries run at the widest window (30 days)
with no dependency on the selected one; changing the window re-slices what is
already loaded. There is a test that spies on the query layer and asserts the call
count does not move when the window changes.

**Null, never zero.** A day with nothing recorded is drawn as a hairline on the
baseline, not a zero-height bar, and every figure renders as an em dash when there
is nothing behind it. A flat line at zero reads as failure when it only means the
app was not in use.

That last rule is also why the focus chart is **bars and not a line**: a line
interpolates across an empty day, inventing a value for a day that has none.

## What can and cannot be scored

A task counts toward estimate accuracy only if it is finished, carried an
estimate, **and** had the timer run on it. Anything else is excluded and counted
separately as "could not be scored" — scoring an unestimated task as zero would
invent accuracy the data does not contain. Sample size is always shown, so a
verdict drawn from three tasks is visibly a verdict drawn from three tasks.

Tolerance is ±20%: inside that band an estimate counts as right.

## Colour

Estimate accuracy is a **diverging** measure — faster ← on target → slower — so it
uses two hues with a neutral grey midpoint, never a third hue in the middle.

The chart fills are their own tokens (`--color-chart-*`), separate from the
semantic ink colours. The ink colours are tuned to be legible as *text* on a dark
surface, which puts them at OKLCH L 0.73–0.78 — outside the band a filled mark
needs. The chart steps were re-derived into the dark band (0.48–0.67) and
validated: the two poles separate by ΔE 25 for normal vision and ΔE 25 under
protanopia, against both the light and dark surfaces.

Every segment carries a text label as well as a colour, so identity is never
colour alone, and the clock-in/out view is a real `<table>` — the accessible
reading of the same data, with exact figures a bar can only approximate.

## Sessions that cross midnight

A session is attributed wholly to the local day it **started**. Someone describing
their own night says "I worked until two", not "I worked two days" — splitting at
00:00 would be more precise and less true to how the day is remembered.
