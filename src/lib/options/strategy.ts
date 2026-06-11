// Options strategy selector — The Wheel + council long plays. Pure, DB-free.
// Risk-minimising defaults: ~0.30 delta short options (~70% prob expire worthless).
// Premiums priced with local Black-Scholes (paper trading).
//
// Contract sizing: all underlyings use a fixed collateral-per-contract (default $500).
// Multiplier = collateralPerContractUsd / strike → normalises exposure across price ranges.
// Example: BTC $62,629 → multiplier ≈ 0.008; SPY $739 → multiplier ≈ 0.676.

import {
  bsGreeks,
  bsPrice,
  roundStrike,
  strikeForDelta,
  yearsTo,
  type Greeks,
  type OptType,
} from "./blackscholes";

export type OptionsStrategyConfig = {
  targetDelta: number; // e.g. 30 → 0.30
  dteMin: number;
  dteMax: number;
  riskFreeRate: number;
  convictionThreshold: number;
  longPlayBudgetUsd: number;
  collateralPerContractUsd: number; // fixed notional per contract (default 500)
};

export type LegSelection = {
  optType: OptType;
  strike: number;
  expiry: Date;
  dte: number;
  premium: number;       // per-unit (BS price)
  premiumTotal: number;  // premium × multiplier
  greeks: Greeks;
  collateralUsd: number; // CSP = collateralPerContractUsd; CC/long = 0
  multiplier: number;    // collateralPerContractUsd / strike — store in DB
  contractSymbol: string;
};

const MS_DAY = 86_400_000;

// Next Friday whose DTE falls within [dteMin, dteMax]. Falls back to first Friday found.
export function expiryFriday(dteMin: number, dteMax: number, now = new Date()): Date {
  let firstFriday: Date | null = null;
  for (let d = 1; d <= dteMax + 7; d++) {
    const cand = new Date(now.getTime() + d * MS_DAY);
    if (cand.getUTCDay() === 5) {
      if (!firstFriday) firstFriday = cand;
      if (d >= dteMin) return atExpiryClose(cand);
    }
  }
  return atExpiryClose(firstFriday ?? new Date(now.getTime() + dteMax * MS_DAY));
}

function atExpiryClose(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(21, 0, 0, 0);
  return x;
}

function fmtExpiry(d: Date): string {
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function mkContractSymbol(underlying: string, expiry: Date, type: OptType, strike: number): string {
  return `${underlying}-${fmtExpiry(expiry)}${type}${strike}`;
}

function buildLeg(
  underlying: string,
  optType: OptType,
  strike: number,
  expiry: Date,
  spot: number,
  sigma: number,
  r: number,
  collateralUsd: number,
  multiplier: number,
  now = new Date()
): LegSelection {
  const t = yearsTo(expiry, now);
  const premium = bsPrice({ type: optType, S: spot, K: strike, t, r, sigma });
  const greeks = bsGreeks({ type: optType, S: spot, K: strike, t, r, sigma });
  const dte = Math.max(0, Math.round((expiry.getTime() - now.getTime()) / MS_DAY));
  return {
    optType,
    strike,
    expiry,
    dte,
    premium,
    premiumTotal: premium * multiplier,
    greeks,
    collateralUsd,
    multiplier,
    contractSymbol: mkContractSymbol(underlying, expiry, optType, strike),
  };
}

// Cash-secured put: short put at ~targetDelta below spot.
// Collateral fixed at collateralPerContractUsd; multiplier = collateral / strike.
export function selectCSP(
  underlying: string,
  spot: number,
  sigma: number,
  cfg: OptionsStrategyConfig,
  now = new Date()
): LegSelection {
  const expiry = expiryFriday(cfg.dteMin, cfg.dteMax, now);
  const t = yearsTo(expiry, now);
  const rawK = strikeForDelta(cfg.targetDelta / 100, "P", spot, t, cfg.riskFreeRate, sigma);
  let strike = roundStrike(Math.min(rawK, spot));
  // roundStrike can nudge back up to/above spot near ATM — re-clamp to keep the put OTM.
  if (strike >= spot) strike = roundStrike(spot * 0.99);
  const multiplier = cfg.collateralPerContractUsd / strike;
  return buildLeg(underlying, "P", strike, expiry, spot, sigma, cfg.riskFreeRate, cfg.collateralPerContractUsd, multiplier, now);
}

// Covered call: short call at ~targetDelta above max(costBasis, spot).
// Strike never below cost basis → avoids locking in a loss.
// `heldUnits` = the actual share/unit count from the wheel (set at assignment). The
// multiplier MUST equal what is held, otherwise the call is over/under-covered (H3).
export function selectCC(
  underlying: string,
  spot: number,
  costBasis: number,
  heldUnits: number,
  sigma: number,
  cfg: OptionsStrategyConfig,
  now = new Date()
): LegSelection {
  const expiry = expiryFriday(cfg.dteMin, cfg.dteMax, now);
  const t = yearsTo(expiry, now);
  const rawK = strikeForDelta(cfg.targetDelta / 100, "C", spot, t, cfg.riskFreeRate, sigma);
  const floor = Math.max(costBasis, spot);
  const strike = roundStrike(Math.max(rawK, floor)); // keep OTM and ≥ cost basis
  const multiplier = heldUnits; // cover exactly the held units, not collateral/strike
  return buildLeg(underlying, "C", strike, expiry, spot, sigma, cfg.riskFreeRate, 0, multiplier, now);
}

// Long play: buy directional option on high council conviction.
// BUY → long call, SELL → long put. Returns null if HOLD, low confidence, or over budget.
export function selectLongPlay(
  underlying: string,
  verdict: "BUY" | "HOLD" | "SELL",
  confidence: number,
  spot: number,
  sigma: number,
  cfg: OptionsStrategyConfig,
  now = new Date()
): LegSelection | null {
  if (verdict === "HOLD") return null;
  if (confidence < cfg.convictionThreshold) return null;
  const optType: OptType = verdict === "BUY" ? "C" : "P";
  const expiry = expiryFriday(cfg.dteMin, cfg.dteMax, now);
  const t = yearsTo(expiry, now);
  const rawK = strikeForDelta(0.4, optType, spot, t, cfg.riskFreeRate, sigma);
  const strike = roundStrike(rawK);
  const multiplier = cfg.collateralPerContractUsd / strike;
  const leg = buildLeg(underlying, optType, strike, expiry, spot, sigma, cfg.riskFreeRate, 0, multiplier, now);
  if (leg.premiumTotal > cfg.longPlayBudgetUsd) return null;
  return leg;
}

export type SettleResult = {
  status: "expired_worthless" | "assigned" | "called_away" | "closed";
  realizedPnl: number;
  assignedUnits?: number;  // units received on assignment (= multiplier × contracts)
  newCostBasis?: number;   // per-unit cost basis after assignment
};

// Settle at expiry using stored contract_multiplier (avoids re-deriving from assetClass).
//
// P&L convention (fixes the old double-count, M1):
//   • Premium collected is realized income, booked ONCE.
//   • On assignment, cost basis = strike (full price paid for the shares). The
//     premium is NOT also subtracted from basis — that was the double-count.
//   • On call-away, realized P&L also includes the capital gain (strike − basis)
//     on the shares sold, which the old code dropped entirely.
export function settle(
  strategy: "csp" | "cc" | "long_call" | "long_put",
  strike: number,
  entryPremium: number,
  spotAtExpiry: number,
  contracts: number,
  contractMultiplier: number, // stored value from ai_options_positions.contract_multiplier
  costBasis?: number          // per-unit basis of held shares (required for cc settlement)
): SettleResult {
  const mult = contractMultiplier * contracts;
  const credit = entryPremium * mult;

  if (strategy === "csp") {
    if (spotAtExpiry < strike) {
      return {
        status: "assigned",
        realizedPnl: credit,   // premium income only; basis is full strike
        assignedUnits: mult,
        newCostBasis: strike,
      };
    }
    return { status: "expired_worthless", realizedPnl: credit };
  }

  if (strategy === "cc") {
    if (spotAtExpiry > strike) {
      // Shares called away at strike: premium + capital gain vs cost basis.
      const capitalGain = costBasis != null ? (strike - costBasis) * mult : 0;
      return { status: "called_away", realizedPnl: credit + capitalGain };
    }
    return { status: "expired_worthless", realizedPnl: credit };
  }

  // long options: intrinsic at expiry − premium paid
  const intrinsic =
    strategy === "long_call"
      ? Math.max(0, spotAtExpiry - strike)
      : Math.max(0, strike - spotAtExpiry);
  return { status: "closed", realizedPnl: intrinsic * mult - credit };
}
