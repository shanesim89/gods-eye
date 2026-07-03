import "server-only";
import { getYahooOptions } from "@/lib/yahoo";
import type { NormalizedChain, OptRow } from "./symbol";

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
  leapsAsk: number;         // per share
  leapsDebitUsd: number;    // ask × 100
  leapsDelta: number;       // from chain IV when available, else ITM-ness proxy
  leapsIV: number;          // chain implied vol (annualized decimal)
  leapsOI: number;
  leapsSpreadPct: number;   // (ask−bid)/mid
  // Short leg (sell at mid)
  shortStrike: number;
  shortExpiry: Date;
  shortDte: number;
  shortMid: number;         // per share
  shortOI: number;
  // Ranking
  annualizedYieldPct: number; // (short mid × 100 × 52/shortDte-weeks) / debit
  affordable: boolean;
  reasons: string[];          // filter failures (empty = passed)
};

export type ScreenerResult = {
  ranked: ScreenedCandidate[]; // passed filters, best first
  rejected: ScreenedCandidate[];
  errors: Record<string, string>;
};

const MS_DAY = 86_400_000;

function mid(row: OptRow): number {
  if (row.bid > 0 && row.ask > 0) return (row.bid + row.ask) / 2;
  return row.lastPrice > 0 ? row.lastPrice : Math.max(row.bid, row.ask);
}

function spreadPct(row: OptRow): number {
  const m = mid(row);
  if (m <= 0 || row.bid <= 0 || row.ask <= 0) return 1; // unquotable = 100%
  return (row.ask - row.bid) / m;
}

// Nearest expiry within [dteMin, dteMax]; null if none listed.
function expiryInWindow(expirations: number[], dteMin: number, dteMax: number, now: Date): number | null {
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

// Deep-ITM call whose moneyness approximates the target delta. Real chains carry
// IV per row, but delta isn't quoted by Yahoo — approximate Δ0.80 as the call
// ~one 30d-sigma below spot, clamped to listed strikes.
function pickLeapsRow(chain: NormalizedChain, targetDelta: number): OptRow | null {
  const spot = chain.underlyingPrice;
  // Δ0.80 ≈ strike at ~78-82% of spot for typical vol/tenor — scan ITM calls and
  // take the one whose ITM fraction best matches the target.
  const itmCalls = chain.calls.filter((c) => c.strike < spot && c.strike > spot * 0.4);
  if (itmCalls.length === 0) return null;
  const targetStrike = spot * (1 - (targetDelta - 50) / 100); // Δ80 → 70% of spot
  return itmCalls.reduce((b, c) =>
    Math.abs(c.strike - targetStrike) < Math.abs(b.strike - targetStrike) ? c : b
  );
}

// OTM call nearest the target short delta (Δ~22 ≈ strike ~5-8% above spot at 30-45d).
function pickShortRow(chain: NormalizedChain, targetDelta: number): OptRow | null {
  const spot = chain.underlyingPrice;
  const otmCalls = chain.calls.filter((c) => c.strike > spot);
  if (otmCalls.length === 0) return null;
  const targetStrike = spot * (1 + targetDelta / 300); // Δ22 → ~7% OTM heuristic
  return otmCalls.reduce((b, c) =>
    Math.abs(c.strike - targetStrike) < Math.abs(b.strike - targetStrike) ? c : b
  );
}

export async function screenPmccCandidates(opts: {
  watchlist: string[];
  accountSizeUsd: number;
  pmccBudgetPct: number;
  leapsDelta: number;   // e.g. 80
  leapsDteMin: number;  // e.g. 180
  leapsDteMax: number;  // e.g. 365
  shortDelta: number;   // e.g. 22
  shortDteMin: number;  // e.g. 30
  shortDteMax: number;  // e.g. 45
  minOpenInterest?: number; // default 100
  maxSpreadPct?: number;    // default 0.10
  now?: Date;
}): Promise<ScreenerResult> {
  const now = opts.now ?? new Date();
  const minOI = opts.minOpenInterest ?? 100;
  const maxSpread = opts.maxSpreadPct ?? 0.1;
  const budget = opts.accountSizeUsd * (opts.pmccBudgetPct / 100);

  const ranked: ScreenedCandidate[] = [];
  const rejected: ScreenedCandidate[] = [];
  const errors: Record<string, string> = {};

  for (const symbol of opts.watchlist) {
    try {
      // First fetch gives the expirations list; snap to the LEAPS window.
      const probe = await getYahooOptions(symbol);
      if (!probe || probe.expirations.length === 0) {
        errors[symbol] = "no chain";
        continue;
      }
      const leapsExp = expiryInWindow(probe.expirations, opts.leapsDteMin, opts.leapsDteMax, now);
      const shortExp = expiryInWindow(probe.expirations, opts.shortDteMin, opts.shortDteMax, now);
      if (!leapsExp || !shortExp) {
        errors[symbol] = !leapsExp ? "no LEAPS expiry listed" : "no 30-45d expiry listed";
        continue;
      }

      const leapsChain = leapsExp === probe.expiry ? probe : await getYahooOptions(symbol, leapsExp);
      const shortChain = shortExp === probe.expiry ? probe : await getYahooOptions(symbol, shortExp);
      if (!leapsChain || !shortChain) {
        errors[symbol] = "chain fetch failed";
        continue;
      }

      const leapsRow = pickLeapsRow(leapsChain, opts.leapsDelta);
      const shortRow = pickShortRow(shortChain, opts.shortDelta);
      if (!leapsRow || !shortRow) {
        errors[symbol] = !leapsRow ? "no ITM LEAPS strike" : "no OTM short strike";
        continue;
      }

      const spot = leapsChain.underlyingPrice;
      const leapsDte = Math.round((leapsExp * 1000 - now.getTime()) / MS_DAY);
      const shortDte = Math.round((shortExp * 1000 - now.getTime()) / MS_DAY);
      const debit = leapsRow.ask * 100;
      const shortMid = mid(shortRow);
      // Weekly-equivalent yield: premium per short cycle, annualized on the debit.
      const cyclesPerYear = 365 / Math.max(1, shortDte);
      const annualizedYieldPct = debit > 0 ? ((shortMid * 100 * cyclesPerYear) / debit) * 100 : 0;

      const reasons: string[] = [];
      if (debit <= 0) reasons.push("no LEAPS ask");
      if (debit > budget) reasons.push(`debit $${debit.toFixed(0)} > budget $${budget.toFixed(0)}`);
      if (leapsRow.openInterest < minOI) reasons.push(`LEAPS OI ${leapsRow.openInterest} < ${minOI}`);
      if (shortRow.openInterest < minOI) reasons.push(`short OI ${shortRow.openInterest} < ${minOI}`);
      if (spreadPct(leapsRow) > maxSpread) reasons.push(`LEAPS spread ${(spreadPct(leapsRow) * 100).toFixed(0)}% > ${maxSpread * 100}%`);
      if (shortMid <= 0) reasons.push("no short quote");
      // Floor invariant must leave room for a credit: shortStrike ≥ leapsStrike + debit/100.
      if (shortRow.strike < leapsRow.strike + leapsRow.ask) reasons.push("floor invariant leaves no OTM short room");

      const cand: ScreenedCandidate = {
        symbol,
        spot,
        leapsStrike: leapsRow.strike,
        leapsExpiry: new Date(leapsExp * 1000),
        leapsDte,
        leapsAsk: leapsRow.ask,
        leapsDebitUsd: debit,
        leapsDelta: leapsRow.greeks?.delta ?? Math.min(0.99, (spot - leapsRow.strike) / spot + 0.5),
        leapsIV: leapsRow.impliedVolatility > 0 ? leapsRow.impliedVolatility : 0.3,
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
  }

  ranked.sort((a, b) => b.annualizedYieldPct - a.annualizedYieldPct);
  return { ranked, rejected, errors };
}
