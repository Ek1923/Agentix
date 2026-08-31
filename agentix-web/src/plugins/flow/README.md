# Flow

An extra plugin, beyond the five in the v1 brief. Delivery metrics: how fast work
gets out, how much is open at once, and where it stops.

## Scope, so this does not become Backtest

Three plugins look at the same data and must answer different questions:

| Plugin | Question |
|---|---|
| **Backtest** (Phase 5) | How accurate were you? Estimate versus actual, completion rate. |
| **Flow** | How does work move? Lead time, cycle time, throughput, stalls. |
| **Workload** | Can you take on what is planned? Measured capacity versus commitments. |

## What it reads

`tasks` and their `sessions` over a 7, 14 or 30 day window, plus `buckets` for the
column breakdown. It writes nothing.

## Metrics

- **Lead time** — created to finished. The whole wait, including days it sat
  untouched, which is what someone waiting on you actually experiences.
- **Cycle time** — first session to finished. How long a thing takes once picked
  up: lead time minus the queue in front of it.
- **Throughput** — finished per day across the window.
- **Open / started** — how much is listed versus how much is genuinely in flight.
- **Stalled** — started and then left for 3+ days. The most useful number here: an
  untouched task is merely planned, but a stalled one is already paid for.
- **Column load** — where open work is piled up. Done columns are excluded, or a
  productive week would read as congestion.

## Two rules

**Median, never mean.** These are personal datasets of a few dozen points, where
one twelve-hour day drags a mean somewhere no real day ever was.

**Null, never zero.** Every metric returns null when there is nothing to measure,
and renders as an em dash. A new board has no lead time; showing "0 days" would be
a claim, and a false one.

## CSV export

Tasks with computed lead and cycle times, for a spreadsheet or a BI tool. Offered
because this is the honest end of "your data stays on your device" — it is only
truly yours if you can take it somewhere else.

Fields beginning `=`, `+`, `-` or `@` are prefixed with a quote. Spreadsheets treat
those as formulas, so a task titled `=1+1` would execute rather than display.
