import "server-only";
import { getYahooOptions } from "@/lib/yahoo";
import type { NormalizedChain, OptRow } from "./symbol";
import { midPrice as mid, spreadPct, expiryInWindow } from "./screener-util";

// PMCC affordability screener — small-account underlying selection.
//
// SPY-class LEAPS (~$8-12k debit) eat a $10k account whole. This screens a static
// watchlist of cheaper, liquid names using REAL Yahoo chains (real bid/ask — a
// realism upgrade over BS-with-HV pricing) and ranks by annualized short-call
// premium yield on the LEAPS capital. The engine buys the top-ranked affordable
// LEAPS when a pmcc_cash slot has auto_select_underlying enabled.
//
// Fetch budget: 2 chain requests per candidate (LEAPS expiry + short expiry)
// → 6 candidates ≈ 12 requests, well inside the Hobby 60s maxDuration.

export type ScreenedCandidate = {
  symbol: string;
  spot: number;
  // LEAPS leg (buy at ask)
  leapsStrike: number;
  leapsExpiry: Date;
  leapsDte: number;
  leapsAsk: number; // per share
  leapsDebitUsd: number; // ask × 100
  leapsDelta: number; // from chain IV when available, else ITM-ness proxy
  leapsIV: number; // chain implied vol (annualized decimal)
  leapsOI: number;
  leapsSpreadPct: number; // (ask−bid)/mid
  // Short leg (sell at mid)
  shortStrike: number;
  shortExpiry: Date;
  shortDte: number;
  shortMid: number; // per share
  shortOI: number;
  // Ranking
  annualizedYieldPct: number; // (short mid × 100 × 52/shortDte-weeks) / debit
  affordable: boolean;
  reasons: string[]; // filter failures (empty = passed)
};

export type ScreenerResult = {
  ranked: ScreenedCandidate[]; // passed filters, best first
  rejected: ScreenedCandidate[];
  errors: Record<string, string>;
};

const MS_DAY = 86_400_000;

// Deep-ITM call whose moneyness approximates the target delta. Real chains carry
// IV per row, but delta isn't quoted by Yahoo — approximate Δ0.80 as the call
// ~one 30d-sigma below spot, clamped to listed strikes.
function pickLeapsRow(
  chain: NormalizedChain,
  targetDelta: number,
): OptRow | null {
  const spot = chain.underlyingPrice;
  // Δ0.80 ≈ strike at ~78-82% of spot for typical vol/tenor — scan ITM calls and
  // take the one whose ITM fraction best matches the target.
  const itmCalls = chain.calls.filter(
    (c) => c.strike < spot && c.strike > spot * 0.4,
  );
  if (itmCalls.length === 0) return null;
  const targetStrike = spot * (1 - (targetDelta - 50) / 100); // Δ80 → 70% of spot
  return itmCalls.reduce((b, c) =>
    Math.abs(c.strike - targetStrike) < Math.abs(b.strike - targetStrike)
      ? c
      : b,
  );
}

// OTM call nearest the target short delta (Δ~22 ≈ strike ~5-8% above spot at 30-45d),
// constrained to strikes at or above `minStrike` (the LEAPS breakeven floor).
//
// The floor matters: selling a call below leapsStrike + leapsAsk books a
// guaranteed loss on the diagonal if it's assigned. This used to be enforced as
// an outright REJECTION after picking the naive Δ-target strike, which threw
// away most of the watchlist — a Δ80 LEAPS' breakeven sits ~9-20% above spot
// (it's ITM, so its extrinsic is large), while a Δ22 short is only ~7% OTM, so
// the naive pick lands under the floor for the majority of underlyings.
// Filtering to eligible strikes FIRST and then picking nearest-to-target among
// them turns those rejections into real (slightly further OTM, lower premium)
// trades. The yield drop is self-correcting: `annualizedYieldPct` falls with the
// premium, so a badly-adapted candidate simply ranks lower / fails minYield.
function pickShortRow(
  chain: NormalizedChain,
  targetDelta: number,
  minStrike = 0,
): OptRow | null {
  const spot = chain.underlyingPrice;
  const otmCalls = chain.calls.filter(
    (c) => c.strike > spot && c.strike >= minStrike,
  );
  if (otmCalls.length === 0) return null;
  const targetStrike = spot * (1 + targetDelta / 300); // Δ22 → ~7% OTM heuristic
  return otmCalls.reduce((b, c) =>
    Math.abs(c.strike - targetStrike) < Math.abs(b.strike - targetStrike)
      ? c
      : b,
  );
}

export async function screenPmccCandidates(opts: {
  watchlist: string[];
  accountSizeUsd: number;
  pmccBudgetPct: number;
  leapsDelta: number; // e.g. 80
  leapsDteMin: number; // e.g. 180
  leapsDteMax: number; // e.g. 365
  shortDelta: number; // e.g. 22
  shortDteMin: number; // e.g. 30
  shortDteMax: number; // e.g. 45
  minOpenInterest?: number; // fallback for both legs when the per-leg knobs are absent
  minLeapsOpenInterest?: number; // default 25 — see note below
  minShortOpenInterest?: number; // default 25
  maxSpreadPct?: number; // default 0.15
  minAnnualizedYieldPct?: number; // default 20
  now?: Date;
}): Promise<ScreenerResult> {
  const now = opts.now ?? new Date();
  // OI/spread thresholds were 100/10% — blue-chip numbers that rejected 100% of
  // the $10-16 watchlist, whose LEAPS are thin by nature. The LEAPS leg is bought
  // once and held for months, so its OI matters far less than the short leg's
  // (rolled monthly); both are tunable now rather than hardcoded.
  const minLeapsOI = opts.minLeapsOpenInterest ?? opts.minOpenInterest ?? 25;
  const minShortOI = opts.minShortOpenInterest ?? opts.minOpenInterest ?? 25;
  const maxSpread = opts.maxSpreadPct ?? 0.15;
  // Guards the floor-adapt in pickShortRow: if clearing the LEAPS breakeven
  // pushes the short so far OTM that the premium is negligible, the diagonal
  // isn't worth the capital — reject instead of opening a dead position.
  const minYield = opts.minAnnualizedYieldPct ?? 20;
  const budget = opts.accountSizeUsd * (opts.pmccBudgetPct / 100);

  const ranked: ScreenedCandidate[] = [];
  const rejected: ScreenedCandidate[] = [];
  const errors: Record<string, string> = {};

  // Symbols fetched in parallel — sequential chain fetches for 6 watchlist
  // symbols (up to 3 Yahoo calls each) blew past the 60s Hobby function cap.
  await Promise.all(
    opts.watchlist.map(async (symbol) => {
      try {
        // First fetch gives the expirations list; snap to the LEAPS window.
        const probe = await getYahooOptions(symbol);
        if (!probe || probe.expirations.length === 0) {
          errors[symbol] = "no chain";
          return;
        }
        const leapsExp = expiryInWindow(
          probe.expirations,
          opts.leapsDteMin,
          opts.leapsDteMax,
          now,
        );
        const shortExp = expiryInWindow(
          probe.expirations,
          opts.shortDteMin,
          opts.shortDteMax,
          now,
        );
        if (!leapsExp || !shortExp) {
          errors[symbol] = !leapsExp
            ? "no LEAPS expiry listed"
            : "no 30-45d expiry listed";
          return;
        }

        const leapsChain =
          leapsExp === probe.expiry
            ? probe
            : await getYahooOptions(symbol, leapsExp);
        const shortChain =
          shortExp === probe.expiry
            ? probe
            : await getYahooOptions(symbol, shortExp);
        if (!leapsChain || !shortChain) {
          errors[symbol] = "chain fetch failed";
          return;
        }

        // LEAPS first — its breakeven (strike + ask) is the floor the short leg
        // must clear, so the short pick depends on it.
        const leapsRow = pickLeapsRow(leapsChain, opts.leapsDelta);
        if (!leapsRow) {
          errors[symbol] = "no ITM LEAPS strike";
          return;
        }
        const breakevenFloor = leapsRow.strike + leapsRow.ask;
        const shortRow = pickShortRow(shortChain, opts.shortDelta, breakevenFloor);
        if (!shortRow) {
          errors[symbol] = "no listed short strike above LEAPS breakeven";
          return;
        }

        const spot = leapsChain.underlyingPrice;
        const leapsDte = Math.round((leapsExp * 1000 - now.getTime()) / MS_DAY);
        const shortDte = Math.round((shortExp * 1000 - now.getTime()) / MS_DAY);
        const debit = leapsRow.ask * 100;
        const shortMid = mid(shortRow);
        // Weekly-equivalent yield: premium per short cycle, annualized on the debit.
        const cyclesPerYear = 365 / Math.max(1, shortDte);
        const annualizedYieldPct =
          debit > 0 ? ((shortMid * 100 * cyclesPerYear) / debit) * 100 : 0;

        const reasons: string[] = [];
        if (debit <= 0) reasons.push("no LEAPS ask");
        if (debit > budget)
          reasons.push(
            `debit $${debit.toFixed(0)} > budget $${budget.toFixed(0)}`,
          );
        if (leapsRow.openInterest < minLeapsOI)
          reasons.push(`LEAPS OI ${leapsRow.openInterest} < ${minLeapsOI}`);
        if (shortRow.openInterest < minShortOI)
          reasons.push(`short OI ${shortRow.openInterest} < ${minShortOI}`);
        if (spreadPct(leapsRow) > maxSpread)
          reasons.push(
            `LEAPS spread ${(spreadPct(leapsRow) * 100).toFixed(0)}% > ${maxSpread * 100}%`,
          );
        if (shortMid <= 0) reasons.push("no short quote");
        // Floor invariant is now enforced by construction in pickShortRow (it only
        // considers strikes ≥ breakeven), so this is a belt-and-braces assertion
        // rather than the main gate it used to be.
        if (shortRow.strike < breakevenFloor)
          reasons.push("short strike below LEAPS breakeven");
        if (annualizedYieldPct < minYield)
          reasons.push(
            `yield ${annualizedYieldPct.toFixed(0)}%/yr < ${minYield}%`,
          );

        const cand: ScreenedCandidate = {
          symbol,
          spot,
          leapsStrike: leapsRow.strike,
          leapsExpiry: new Date(leapsExp * 1000),
          leapsDte,
          leapsAsk: leapsRow.ask,
          leapsDebitUsd: debit,
          leapsDelta:
            leapsRow.greeks?.delta ??
            Math.min(0.99, (spot - leapsRow.strike) / spot + 0.5),
          leapsIV:
            leapsRow.impliedVolatility > 0 ? leapsRow.impliedVolatility : 0.3,
          leapsOI: leapsRow.openInterest,
          leapsSpreadPct: spreadPct(leapsRow),
          shortStrike: shortRow.strike,
          shortExpiry: new Date(shortExp * 1000),
          shortDte,
          shortMid,
          shortOI: shortRow.openInterest,
          annualizedYieldPct,
          affordable: debit > 0 && debit <= budget,
          reasons,
        };
        (reasons.length === 0 ? ranked : rejected).push(cand);
      } catch (err) {
        errors[symbol] = err instanceof Error ? err.message : "unknown";
      }
    }),
  );

  ranked.sort((a, b) => b.annualizedYieldPct - a.annualizedYieldPct);
  return { ranked, rejected, errors };
}

// Re-exported from screener-util (a server-only-free module) so callers keep the
// familiar `from "./screener"` path while unit tests import the pure logic
// directly (screener.ts carries `import "server-only"`, unimportable under vitest).
export { isTransientScreenerResult } from "./screener-util";
