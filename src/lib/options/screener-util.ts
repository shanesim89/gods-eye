// Pure screener helpers — deliberately free of `import "server-only"` so vitest
// can exercise them. Only type-imports from screener.ts/symbol.ts (erased at
// runtime), so importing this file never pulls in the server-only Yahoo fetch path.
import type { ScreenerResult } from "./screener";
import type { OptRow } from "./symbol";

// Screener liquidity/quality knobs, in one place so they can be tuned without
// hunting through the fetch loop. These are passed explicitly from engine.ts
// rather than left to screenPmccCandidates' internal defaults, so the values the
// live cron actually runs with are visible here.
//
// Promoting these to `ai_options_settings` columns is the natural next step —
// it needs an additive migration, so they live as constants until then.
export const SCREENER_TUNING = {
  // The LEAPS is bought once and held for months; the short leg is rolled every
  // 30-45 days, so it's the one that genuinely needs a liquid book. Splitting the
  // two (was a single OI≥100 for both) is what lets thin-but-usable LEAPS through.
  minLeapsOpenInterest: 25,
  minShortOpenInterest: 25,
  maxSpreadPct: 0.15,
  minAnnualizedYieldPct: 20,
} as const;

// Cap on how many new diagonals one run may open. Bounded so a single run can't
// deploy the entire account into positions that all share the same entry date.
export const MAX_NEW_DIAGONALS_PER_RUN = 3;

export function midPrice(row: OptRow): number {
  if (row.bid > 0 && row.ask > 0) return (row.bid + row.ask) / 2;
  return row.lastPrice > 0 ? row.lastPrice : Math.max(row.bid, row.ask);
}

export function spreadPct(row: OptRow): number {
  const m = midPrice(row);
  if (m <= 0 || row.bid <= 0 || row.ask <= 0) return 1; // unquotable = 100%
  return (row.ask - row.bid) / m;
}

// Nearest expiry within [dteMin, dteMax]; null if none listed.
export function expiryInWindow(
  expirations: number[],
  dteMin: number,
  dteMax: number,
  now: Date
): number | null {
  const nowSec = now.getTime() / 1000;
  const inWindow = expirations.filter((e) => {
    const dte = (e - nowSec) / 86_400;
    return dte >= dteMin && dte <= dteMax;
  });
  if (inWindow.length > 0) return inWindow[0];
  // fall back to first past dteMin (LEAPS chains list sparse expiries)
  const past = expirations.filter((e) => (e - nowSec) / 86_400 >= dteMin);
  return past.length > 0 ? past[0] : null;
}

// A screener run yields NO affordable pick for two very different reasons:
//   • transient — market closed / feed hiccup: quotes read $0 (ask=0 → debit=0 →
//     "no LEAPS ask"/"no short quote"), or the fetch errored. This should be
//     RETRIED on the next run, not treated as the week's decision.
//   • terminal — market open, real quotes, but every candidate is genuinely
//     unaffordable/illiquid (debit > budget, OI too low, spread too wide). This
//     IS a real weekly decision; don't hammer the feed retrying it.
// Returns true only for the transient case (ranked empty AND every failure is
// quote-absence or an outright fetch error). Used by the engine to decide whether
// to roll back the weekly idempotency claim so a bad run self-heals.
export function isTransientScreenerResult(r: ScreenerResult): boolean {
  if (r.ranked.length > 0) return false; // we have a pick — not a failure at all
  const hadErrors = Object.keys(r.errors).length > 0;
  const allQuoteless =
    r.rejected.length > 0 &&
    r.rejected.every((c) =>
      c.reasons.some((reason) => reason.includes("no LEAPS ask") || reason.includes("no short quote"))
    );
  // No rejected candidates AND no errors ⇒ empty watchlist / nothing screened:
  // harmless to retry, so treat as transient too.
  if (!hadErrors && r.rejected.length === 0) return true;
  return hadErrors || allQuoteless;
}
