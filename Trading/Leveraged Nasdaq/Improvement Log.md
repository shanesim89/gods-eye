---
tags: [leveraged, trading-bot, improvement-log, nasdaq-3x]
status: active
created: 2026-09-24
project: leveraged-nasdaq
---

# Leveraged Nasdaq (TQQQ/SQQQ) — Improvement Log

Self-updating log, same shape as [[Vulcan Equity/Improvement Log]]. Add new `## Idea`
entries at bottom. Full statistical writeup for each lives in
`quant-scrap/leveraged/RESULTS.md` — this log is the index, not the analysis.

## Status board

```dataview
TABLE status, brain, impact, created
FROM "Trading/Leveraged Nasdaq"
WHERE type = "idea"
SORT created DESC
```

---

## Idea 7 — QQQ_FRESH_BREAKOUT_V3: breakout-strength + CLV + RelativeTR filters
type:: idea
brain:: Scanner
status:: null-result
impact:: none
created:: 2026-09-24
done:: 2026-09-24

User-supplied 61-section spec for a new signal on the same TQQQ/SQQQ pair: EMA bias +
rolling breakout, gated by ATR-normalized breakout-strength, close-location-value, and
a 20-session time-of-day-normalized RelativeTR. Repo audit found ~90% of the spec
(paper enforcement, risk limits, broker reconciliation, exits) already built and
matching exactly — only the filter stack itself was new.

Ran Stage 0 (cheapest validation, no engine/exits) per the staged plan's gate: mean
forward return must clear the ~11bps round-trip cost floor at the 5th bootstrap
percentile, and be powered. **Result: 0/432 configs cleared it.** Best config +6.75bps
mean, CI5 −3.40, n=289 — well-powered (417/432 rows), so this is a genuine null, not
an underpowered sample. Stopped before any engine/exit work per the fail-stop gate.

Full writeup: `quant-scrap/leveraged/RESULTS.md` §4.6. This is the 7th breakout-family
variant tested on TQQQ/SQQQ (after §2, §4.2) — all seven null.

New reusable machinery: `indicators.py::relative_tr` (20-session trailing median per
time-of-day bucket) — kept for any future hypothesis wanting a historical, not
in-session-expanding, range baseline.

---

## Idea 8 — multi-day swing hold, long AND short both instruments
type:: idea
brain:: Scanner
status:: null-result
impact:: none
created:: 2026-09-24
done:: 2026-09-24

First hypothesis on this pair to test literal shorting of TQQQ/SQQQ rather than the
live bot's instrument-choice-only design (long TQQQ up bias, long SQQQ down bias,
never short — per `config.py`'s docstring). QQQ EMA bias (4 fast/slow pairs) held
1/2/3/5 sessions, long and short, on both TQQQ and SQQQ. 64 configs, same 11bps
cost-floor gate at the 5th bootstrap percentile as every other hypothesis here.

**Result: 4/64 clear the floor at the 5th percentile, but 0/64 are powered —
underpowered null, not a resolved one.** Standout cell: short SQQQ on EMA 21/50,
5-session hold, mean +207.5bps, CI5 +79.2 — clears by a wide margin but MDE (132bps)
exceeds what the sample can resolve (n=79). Notable asymmetry across the four
symbol/direction cells: short SQQQ +82bps mean vs short TQQQ −84bps mean, consistent
with (not proof of) a volatility-decay story for shorting leveraged ETFs. Stopped
before any engine/exit work per the fail-stop gate — unlike Idea 7, this is a sample-
size problem, not a structural absence of signal, and is the first candidate to
revisit if more cached history becomes available.

Full writeup: `quant-scrap/leveraged/RESULTS.md` §4.7.

---

## Log of decisions

```dataview
TABLE status, impact
FROM "Trading/Leveraged Nasdaq"
WHERE type = "idea" AND (status = "done" OR status = "null-result")
SORT created DESC
```
