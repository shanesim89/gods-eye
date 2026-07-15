import "server-only";
import { getYahooOptions } from "@/lib/yahoo";
import { bsGreeks, roundStrike, strikeForDelta, yearsTo, type Greeks } from "./blackscholes";
import { expiryInWindow, spreadPct } from "./screener-util";
import type { OptRow } from "./symbol";
import { adjustCCDeltaForVerdict, type LegSelection } from "./strategy";

// Real-chain pricing for the wheel's CSP/CC legs — the same "real Yahoo bid/ask
// instead of Black-Scholes-off-historical-vol" upgrade the PMCC screener already
// applies to LEAPS/short-call legs (screener.ts), extended to the plain wheel.
//
// Why this matters: strategy.ts's selectCSP/selectCC price purely off a 30-day
// realized-vol estimate — it has no way to know if a Δ22 put is actually rich or
// cheap right now, especially around earnings/catalysts realized vol can't see
// coming. This module fetches the real chain, picks the strike nearest the
// delta target (still BS-computed, same target-delta math as strategy.ts — the
// improvement is REAL premium/liquidity, not a different strike-selection
// model), and returns null on any failure (no chain, no listed expiry in
// window, thin liquidity, no real bid) so the caller can fall back to the
// existing BS-off-HV path exactly as before. Additive only — never a hard
// dependency, so a bad/closed-market/illiquid-name day degrades gracefully to
// today's behavior instead of blocking a trade.

export type RealLegQuote = {
  strike: number;
  expiry: Date;
  dte: number;
  bid: number;
  ask: number;
  premium: number; // = bid — the conservative real fill for a sale
  greeks: Greeks;
  openInterest: number;
  spreadPct: number;
  iv: number;
  contractSymbol: string;
};

function fmtExpiry(d: Date): string {
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function mkContractSymbol(underlying: string, expiry: Date, type: "C" | "P", strike: number): string {
  return `${underlying}-${fmtExpiry(expiry)}${type}${strike}`;
}

function nearestRow(rows: OptRow[], targetStrike: number): OptRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, r) => (Math.abs(r.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? r : best));
}

export type LiquidityFilter = { minOpenInterest?: number; maxSpreadPct?: number };

async function fetchRealLeg(
  underlying: string,
  optType: "C" | "P",
  targetStrike: number,
  dteMin: number,
  dteMax: number,
  strikeRows: (rows: OptRow[]) => OptRow[],
  riskFreeRate: number,
  now: Date,
  { minOpenInterest = 50, maxSpreadPct = 0.15 }: LiquidityFilter = {}
): Promise<RealLegQuote | null> {
  const probe = await getYahooOptions(underlying);
  if (!probe || probe.expirations.length === 0) return null;
  const exp = expiryInWindow(probe.expirations, dteMin, dteMax, now);
  if (!exp) return null;
  const chain = exp === probe.expiry ? probe : await getYahooOptions(underlying, exp);
  if (!chain) return null;
  const candidates = strikeRows(optType === "P" ? chain.puts : chain.calls);
  const row = nearestRow(candidates, targetStrike);
  if (!row) return null;
  if (row.openInterest < minOpenInterest) return null;
  if (spreadPct(row) > maxSpreadPct) return null;
  if (row.bid <= 0) return null; // unfillable at a real bid — don't fabricate a sale price
  const expiry = new Date(exp * 1000);
  const dte = Math.round((expiry.getTime() - now.getTime()) / 86_400_000);
  const iv = row.impliedVolatility > 0 ? row.impliedVolatility : 0.3;
  const t = yearsTo(expiry, now);
  const greeks = bsGreeks({ type: optType, S: chain.underlyingPrice, K: row.strike, t, r: riskFreeRate, sigma: iv });
  return {
    strike: row.strike,
    expiry,
    dte,
    bid: row.bid,
    ask: row.ask,
    premium: row.bid,
    greeks,
    openInterest: row.openInterest,
    spreadPct: spreadPct(row),
    iv,
    contractSymbol: mkContractSymbol(underlying, expiry, optType, row.strike),
  };
}

// Cash-secured put: same Δ-target math as strategy.ts's selectCSP, but the
// strike is snapped to a REAL listed put and premium is that put's real bid.
export async function fetchRealCSPQuote(
  underlying: string,
  spot: number,
  sigma: number,
  cfg: { targetDelta: number; dteMin: number; dteMax: number; riskFreeRate: number },
  now = new Date(),
  liquidity?: LiquidityFilter
): Promise<RealLegQuote | null> {
  const approxT = (cfg.dteMin + cfg.dteMax) / 2 / 365;
  const rawK = strikeForDelta(cfg.targetDelta / 100, "P", spot, approxT, cfg.riskFreeRate, sigma);
  let targetStrike = roundStrike(Math.min(rawK, spot));
  if (targetStrike >= spot) targetStrike = roundStrike(spot * 0.99);
  return fetchRealLeg(
    underlying,
    "P",
    targetStrike,
    cfg.dteMin,
    cfg.dteMax,
    (rows) => rows.filter((r) => r.strike < spot),
    cfg.riskFreeRate,
    now,
    liquidity
  );
}

// Covered call: same floor (strike never below cost basis) as strategy.ts's
// selectCC, snapped to a real listed call with a real bid.
export async function fetchRealCCQuote(
  underlying: string,
  spot: number,
  costBasis: number,
  sigma: number,
  cfg: { targetDelta: number; dteMin: number; dteMax: number; riskFreeRate: number; convictionThreshold: number },
  now = new Date(),
  liquidity?: LiquidityFilter,
  verdict?: "BUY" | "HOLD" | "SELL",
  confidence?: number
): Promise<RealLegQuote | null> {
  const effectiveDelta = adjustCCDeltaForVerdict(cfg.targetDelta, verdict, confidence, cfg.convictionThreshold);
  const approxT = (cfg.dteMin + cfg.dteMax) / 2 / 365;
  const rawK = strikeForDelta(effectiveDelta / 100, "C", spot, approxT, cfg.riskFreeRate, sigma);
  const floor = Math.max(costBasis, spot);
  const targetStrike = roundStrike(Math.max(rawK, floor));
  return fetchRealLeg(
    underlying,
    "C",
    targetStrike,
    cfg.dteMin,
    cfg.dteMax,
    (rows) => rows.filter((r) => r.strike >= floor),
    cfg.riskFreeRate,
    now,
    liquidity
  );
}

// Adapter so engine.ts can use a RealLegQuote anywhere it currently uses a
// strategy.ts LegSelection — same field names, so the DB-insert code doesn't
// need to branch on where the leg's data came from.
export function toLegSelection(
  underlying: string,
  optType: "C" | "P",
  quote: RealLegQuote,
  multiplier: number,
  collateralUsd: number
): LegSelection {
  return {
    optType,
    strike: quote.strike,
    expiry: quote.expiry,
    dte: quote.dte,
    premium: quote.premium,
    premiumTotal: quote.premium * multiplier,
    greeks: quote.greeks,
    collateralUsd,
    multiplier,
    contractSymbol: quote.contractSymbol,
  };
}
