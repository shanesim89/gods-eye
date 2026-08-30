# Vulcan Equity Screener Bot — Design

Status: approved by Shane 2026-08-30, pending spec review before implementation plan.

## Context

New paper-trading sleeve for gods-eye, modeled loosely on the "Vulcan" stock-screening
framework (theme rank → relative-strength/volume/stage scoring). Vulcan's source
material is a screener, not a trading system — entry/exit, sizing, and cadence below
are decisions made during brainstorming, not requirements pulled from the source.

Runs alongside the existing paper sleeves (options wheel/PMCC, quant scalper) and the
live crypto DCA sleeve, tracked on the same home dashboard.

## Goals

- Weekly-ranked list of ~20 equities, picked by sector momentum + per-stock RS/volume/stage scoring.
- Fully automated paper trading via Alpaca (equal-weight buy top 20, rotate out on rank drop).
- Visible on the gods-eye paper-fleet dashboard as a new sleeve.

## Non-goals (v1)

- No insider-filing (SEC Form 4) signal — no EDGAR integration exists in gods-eye today; can be added later as a 4th factor if the 3-factor version proves out.
- No stop-loss or other risk overlay — pure rank-rotation.
- No in-app settings/kill-switch UI — constants are hardcoded in the bot script for v1.
- No live S&P500 constituent feed — a bundled static list, manually refreshed occasionally.

## Architecture

Vulcan runs as a new Python bot on the VPS (`quant-scrap/vulcan/`), cron-scheduled,
writing directly to Neon via `psycopg2` — the same split already used by
`quant-scrap/brain/options_db.py` and the quant-scalper/goldscalp bots. Next.js
(gods-eye, on Vercel) only *reads* Neon for the dashboard; it does not compute scores
or place orders. This avoids Vercel's 60s cron timeout, which a ~150-200-name weekly
scan would not reliably fit inside.

```
VPS (cron, weekly)                          Vercel (Next.js, on page load)
┌─────────────────────────┐                 ┌──────────────────────────┐
│ vulcan/run.py            │                 │ vulcan-dashboard.ts       │
│  1. theme_rank.py         │  writes to      │  reads vulcan_positions   │
│  2. scoring.py            │ ───────────────▶│  reads vulcan_scores      │
│  3. rebalance.py          │  Neon (psycopg2)│  (read-only)              │
│     └ alpaca_equity.py    │                 └──────────────────────────┘
└─────────────────────────┘
```

## Universe

Static JSON bundled in `quant-scrap/vulcan/sp500_universe.json`: `{symbol, sector}` for
current S&P500 constituents (11 GICS sectors). Manually refreshed if membership drifts —
no scraper/API integration for v1.

## Weekly pipeline (`quant-scrap/vulcan/`)

Runs Monday 13:00 UTC (`0 13 * * 1`, matching the existing `dca` cron's UTC convention —
pre-US-market-open), scoring off the prior week's closes.

### 1. Theme rank (`theme_rank.py`)

For each of the 11 GICS sectors present in the universe, compute blended momentum =
`0.5 * return_1mo + 0.5 * return_3mo`, where each return is trailing total return of the
**equal-weight average** of that sector's constituents (using daily closes from Yahoo,
same unofficial endpoint `yahoo.ts` already uses — `query1.finance.yahoo.com/v8/finance/chart`,
called via `requests` in Python). Rank sectors descending by blended momentum; take the
top 4 sectors. Their constituents (~150-200 names) become this week's scoring universe.

### 2. Per-stock scoring (`scoring.py`)

For every name in the top-4-sector universe (SPY included as a reference, excluded from
ranking):

- **RS percentile**: 6-month (126 trading day) total return, percentile-ranked (0-100)
  against every other name in this week's scoring universe (not the full S&P500).
- **U/D ratio**: `sum(volume on up days) / sum(volume on down days)` over the trailing 50
  sessions (a day counts as "up" if close > prior close, "down" if close < prior close;
  flat days excluded from both sums). Percentile-ranked (0-100) the same way as RS.
- **Stage gate** (binary, not a 4-way classifier): resample daily closes to weekly
  (last close of each week), compute the 30-week SMA and its 5-week slope
  (`SMA[t] - SMA[t-5]`). A name is **Stage-2-eligible** iff `price > SMA30w` AND
  `slope > 0`. Names failing this gate are excluded entirely from the top-20 selection,
  regardless of RS/U-D score. (This collapses Weinstein's 4 stages into the one
  distinction that matters for entry: "in a confirmed uptrend" or not — no attempt to
  separately detect stage 1/3/4.)

Composite score = `(RS_percentile + UD_percentile) / 2`, computed for every name in the
scoring universe; Stage-2 filter is applied *after* scoring (so percentiles stay
meaningful against the full 150-200-name universe), then the top 20 by composite score
are taken from the Stage-2-eligible subset.

Any name whose Yahoo fetch fails (network error, no data) is skipped and excluded from
that week's universe — logged, does not fail the run (matches `yahoo.ts`/`wheel-chain.ts`'s
existing "return null on failure, caller skips" convention).

### 3. Rebalance (`rebalance.py`)

Compare this week's top 20 to currently-open rows in `vulcan_positions`:

- **Drop-outs** (held, no longer in top 20): market-sell full held quantity.
- **New entrants** (in top 20, not currently held): market-buy using Alpaca's
  **notional** order type (`notional: 250`, no `qty`) — Alpaca computes the fractional
  share count itself, so no local fractional-share math is needed.
- **Still-ranked** (held and still in top 20): no action.

Sells execute before buys in the same run, so proceeds are available for buying power
checks. If a buy is rejected for insufficient buying power (should be rare given sells
run first), skip that one buy, log a `strategy_events` row, continue the rest of the run
— do not abort the whole rebalance.

Orders go through a new `vulcan/alpaca_equity.py` — a small REST client (~50 lines,
`requests`, no SDK) against the same paper endpoints `alpaca.ts` uses
(`https://paper-api.alpaca.markets`), but for plain equities: `GET /v2/account`,
`GET /v2/positions`, `POST /v2/orders` with `{symbol, side, type: "market",
time_in_force: "day", notional | qty}`. No `position_intent` field (options-only).

### 4. Audit trail

Each weekly run writes a `strategy_runs`/`strategy_events` row under
`strategy_key = "vulcan-equity"`, `mode = "paper"` — same tables `ledger.ts` already
defines on the Next.js side; Python writes them via raw SQL matching the existing
column names (same pattern as `options_db.py`).

## Data model (new Neon tables, Drizzle-owned schema in gods-eye repo)

```sql
vulcan_positions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  symbol        text not null,
  qty           numeric not null,
  entry_price   numeric not null,
  entry_date    timestamptz not null,
  still_open    boolean not null default true,
  exit_price    numeric,
  exit_date     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
)

vulcan_scores (
  id                 uuid primary key default gen_random_uuid(),
  run_date           date not null,
  symbol             text not null,
  sector             text not null,
  rs_percentile      numeric not null,
  ud_ratio           numeric not null,
  ud_percentile      numeric not null,
  stage2_eligible    boolean not null,
  composite_score    numeric not null,
  composite_rank     integer,           -- null if not in that week's top 20
  created_at         timestamptz not null default now()
)
```

`vulcan_scores` gives the dashboard a full weekly snapshot (why a name is/isn't ranked),
not just the current top 20 — useful for later debugging/tuning.

## Dashboard integration (gods-eye, Next.js)

- New `BotKey: "vulcan"` in `src/lib/ai-portfolio/registry.ts`, added to
  `ACTIVE_STRATEGIES` (mode `PAPER`), `PAPER_STRATEGY_KEYS`, `CALENDAR_STRATEGY_KEYS`.
- New `src/lib/trading/vulcan-dashboard.ts` — read-only, queries `vulcan_positions`
  (open holdings + P&L via current Yahoo price) and latest `vulcan_scores` run (ranked
  list). Modeled on the read side of `options-dashboard.ts`, much simpler (no wheel
  state machine, no greeks).
- New page `src/app/ai-portfolio/vulcan/page.tsx` — holdings table + ranked
  candidate list, same layout family as the existing `/ai-portfolio/options` page.
- Slotted into the home dashboard's `PaperFleetColumn` and `HeroStrip`, next to
  `quant`/`options`.

## Testing / verification

- Python: unit tests for `scoring.py` (RS/UD percentile math, stage-gate boundary
  cases) and `rebalance.py` (drop-out/entrant/hold diff logic) using
  `quant-scrap/mcscalp/tests`-style plain `pytest`, no fixtures/mocks beyond stubbing
  Yahoo responses.
- `alpaca_equity.py`: exercised against the paper endpoint directly (same manual
  verification style as `scripts/alpaca-check.mjs` does for the Node broker).
- TypeScript side: `vulcan-dashboard.ts` gets a unit test in the existing vitest setup
  (mocked DB rows in, wire shape out), matching `options-dashboard.ts`'s test
  conventions if any exist, otherwise matching `strategy-context.test.ts`'s mocking
  style.
- `npx tsc --noEmit` clean after the Next.js-side changes (registry, dashboard reader,
  new page, schema).
- End-to-end dry run on the VPS: run `vulcan/run.py` once against real Yahoo data with
  Alpaca paper keys, inspect `vulcan_scores`/`vulcan_positions` rows written, confirm
  orders appear in the Alpaca paper account.

## Cut from v1 (explicit)

- Insider-filing signal (SEC EDGAR Form 4) — no integration exists; add later as a 4th
  factor if 3-factor version proves out.
- Stop-loss / risk overlay — pure rank-rotation only.
- Settings/kill-switch table — hardcoded constants (`TOP_N = 20`, `POSITION_NOTIONAL_USD = 250`,
  weekly Monday cadence) in the Python script. Promote to a DB-backed settings row
  later if in-app tuning is wanted.
- Live S&P500 constituent feed — static bundled JSON, manual refresh.
