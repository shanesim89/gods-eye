// Pure screener helpers — deliberately free of `import "server-only"` so vitest
// can exercise them. Only type-imports from screener.ts/symbol.ts (erased at
// runtime), so importing this file never pulls in the server-only Yahoo fetch path.
import type { ScreenerResult } from "./screener";
import type { OptRow } from "./symbol";

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
