import "server-only";
import { getDeribitChain } from "./deribit";
import { bsGreeks, roundStrike, strikeForDelta, yearsTo } from "./blackscholes";
import { expiryInWindow, spreadPct } from "./screener-util";
import type { OptRow } from "./symbol";
import { adjustCCDeltaForVerdict } from "./strategy";
import type { RealLegQuote } from "./wheel-chain";
import { buildDeribitInstrument } from "./deribit";

// Real-chain pricing for the wheel's CSP/CC legs on crypto underlyings — the
// Deribit counterpart to wheel-chain.ts's Yahoo-sourced fetchRealCSPQuote/
// fetchRealCCQuote (lever 1), extended to BTC/ETH per live-readiness
// milestone "deribit_wheel_wiring". Returns the SAME RealLegQuote shape as
// wheel-chain.ts so engine.ts's existing toLegSelection adapter works
// unchanged for either source.
//
// NOTE: engine.ts's whole-contracts guardrail (GUARDRAIL 1.5) already skips
// ALL crypto underlyings when whole_contracts=true — a real 1-coin Deribit
// contract's collateral (spot × 100... no, ×1, but still $60-100k for BTC)
// doesn't fit a $5-15k account. This module only actually gets called in
// FRACTIONAL mode (whole_contracts=false), where crypto collateral is sized
// down to collateralPerContractUsd like everything else. Same pattern as the
// AAPL/Alpaca live path: correct wiring that a real account's own guardrails
// may legitimately never exercise, depending on settings.

function nearestRow(rows: OptRow[], targetStrike: number): OptRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, r) => (Math.abs(r.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? r : best));
}

export type LiquidityFilter = { minOpenInterest?: number; maxSpreadPct?: number };

async function fetchDeribitLeg(
  currency: "BTC" | "ETH",
  optType: "C" | "P",
  targetStrike: number,
  dteMin: number,
  dteMax: number,
  riskFreeRate: number,
  now: Date,
  strikeRows: (rows: OptRow[]) => OptRow[],
  { minOpenInterest = 5, maxSpreadPct = 0.25 }: LiquidityFilter = {}
): Promise<RealLegQuote | null> {
  // Crypto books are thinner than equity chains — Yahoo's defaults (OI≥50,
  // spread≤15%) would reject nearly every BTC/ETH strike. Looser but still
  // real: still requires an actual bid, just tolerates the wider crypto market.
  const probe = await getDeribitChain(currency);
  if (!probe || probe.expirations.length === 0) return null;
  const exp = expiryInWindow(probe.expirations, dteMin, dteMax, now);
  if (!exp) return null;
  const chain = exp === probe.expiry ? probe : await getDeribitChain(currency, exp);
  if (!chain) return null;
  const candidates = strikeRows(optType === "P" ? chain.puts : chain.calls);
  const row = nearestRow(candidates, targetStrike);
  if (!row) return null;
  if (row.openInterest < minOpenInterest) return null;
  if (spreadPct(row) > maxSpreadPct) return null;
  if (row.bid <= 0) return null; // unfillable at a real bid — don't fabricate a sale price

  const expiry = new Date(exp * 1000);
  const dte = Math.round((expiry.getTime() - now.getTime()) / 86_400_000);
  const iv = row.impliedVolatility > 0 ? row.impliedVolatility : 0.6; // crypto fallback vol, matches engine.ts's crypto histVol fallback
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
    contractSymbol: buildDeribitInstrument(currency, exp, row.strike, optType),
  };
}

// Cash-secured put — same Δ-target math as wheel-chain.ts's fetchRealCSPQuote,
// snapped to a REAL listed Deribit put with a real bid.
export async function fetchDeribitCSPQuote(
  underlying: string,
  spot: number,
  sigma: number,
  cfg: { targetDelta: number; dteMin: number; dteMax: number; riskFreeRate: number },
  now = new Date(),
  liquidity?: LiquidityFilter
): Promise<RealLegQuote | null> {
  const currency = underlying.toUpperCase() as "BTC" | "ETH";
  const approxT = (cfg.dteMin + cfg.dteMax) / 2 / 365;
  const rawK = strikeForDelta(cfg.targetDelta / 100, "P", spot, approxT, cfg.riskFreeRate, sigma);
  let targetStrike = roundStrike(Math.min(rawK, spot));
  if (targetStrike >= spot) targetStrike = roundStrike(spot * 0.99);
  return fetchDeribitLeg(
    currency, "P", targetStrike, cfg.dteMin, cfg.dteMax, cfg.riskFreeRate, now,
    (rows) => rows.filter((r) => r.strike < spot),
    liquidity
  );
}

// Covered call — same floor + council-verdict delta adjustment (lever 2) as
// wheel-chain.ts's fetchRealCCQuote, snapped to a real listed Deribit call.
export async function fetchDeribitCCQuote(
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
  const currency = underlying.toUpperCase() as "BTC" | "ETH";
  const effectiveDelta = adjustCCDeltaForVerdict(cfg.targetDelta, verdict, confidence, cfg.convictionThreshold);
  const approxT = (cfg.dteMin + cfg.dteMax) / 2 / 365;
  const rawK = strikeForDelta(effectiveDelta / 100, "C", spot, approxT, cfg.riskFreeRate, sigma);
  const floor = Math.max(costBasis, spot);
  const targetStrike = roundStrike(Math.max(rawK, floor));
  return fetchDeribitLeg(
    currency, "C", targetStrike, cfg.dteMin, cfg.dteMax, cfg.riskFreeRate, now,
    (rows) => rows.filter((r) => r.strike >= floor),
    liquidity
  );
}
