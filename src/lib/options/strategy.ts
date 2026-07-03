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
  // PMCC (Poor Man's Covered Call) — diagonal. Deep-ITM long LEAPS as stock surrogate,
  // short OTM calls sold against it. Only read on pmcc-mode underlyings.
  pmccLeapsDelta: number;  // e.g. 80 → 0.80 deep-ITM
  pmccLeapsDteMin: number; // e.g. 180
  pmccLeapsDteMax: number; // e.g. 365
  pmccBudgetUsd: number;   // max debit paid per LEAPS buy (hard ceiling)
  // ── Live-account realism ────────────────────────────────────────────────────
  accountSizeUsd: number;      // total account the book must fit inside
  wholeContracts: boolean;     // true → 1 contract = 100 units, no fractional multipliers
  shortDteMin: number;         // PMCC short-leg DTE window (30-45), separate from CSP dte
  shortDteMax: number;
  pmccBudgetPct: number;       // LEAPS debit ≤ this % of account (whole-contracts mode)
  profitTakePct: number;       // close short at this % of max profit
  rollDte: number;             // roll/close short at this DTE
  commissionPerContract: number; // $/contract, each open or close
  slippagePct: number;         // % of premium: shorts receive less, longs pay more
};

// Fill model: model price is the mid; slippage haircuts the fill against us.
// Short (selling): receive premium × (1 − s). Long (buying): pay premium × (1 + s).
export function applySlippage(premium: number, side: "short" | "long", slippagePct: number): number {
  const s = slippagePct / 100;
  return side === "short" ? premium * (1 - s) : premium * (1 + s);
}

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
  now = new Date(),
  side?: "short" | "long",
  slippagePct = 0
): LegSelection {
  const t = yearsTo(expiry, now);
  const mid = bsPrice({ type: optType, S: spot, K: strike, t, r, sigma });
  const premium = side ? applySlippage(mid, side, slippagePct) : mid;
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
// Whole-contracts mode: multiplier = 100, collateral = strike × 100 (real cash-secured
// sizing). Returns null when the collateral won't fit in availableCashUsd — that is
// correct $10k-account realism (AAPL/SPY CSPs are simply unaffordable).
export function selectCSP(
  underlying: string,
  spot: number,
  sigma: number,
  cfg: OptionsStrategyConfig,
  now = new Date(),
  availableCashUsd?: number
): LegSelection | null {
  const expiry = expiryFriday(cfg.dteMin, cfg.dteMax, now);
  const t = yearsTo(expiry, now);
  const rawK = strikeForDelta(cfg.targetDelta / 100, "P", spot, t, cfg.riskFreeRate, sigma);
  let strike = roundStrike(Math.min(rawK, spot));
  // roundStrike can nudge back up to/above spot near ATM — re-clamp to keep the put OTM.
  if (strike >= spot) strike = roundStrike(spot * 0.99);
  const multiplier = cfg.wholeContracts ? 100 : cfg.collateralPerContractUsd / strike;
  const collateral = cfg.wholeContracts ? strike * 100 : cfg.collateralPerContractUsd;
  if (cfg.wholeContracts && availableCashUsd != null && collateral > availableCashUsd) return null;
  return buildLeg(underlying, "P", strike, expiry, spot, sigma, cfg.riskFreeRate, collateral, multiplier, now, "short", cfg.slippagePct);
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
  return buildLeg(underlying, "C", strike, expiry, spot, sigma, cfg.riskFreeRate, 0, multiplier, now, "short", cfg.slippagePct);
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
  const multiplier = cfg.wholeContracts ? 100 : cfg.collateralPerContractUsd / strike;
  const leg = buildLeg(underlying, optType, strike, expiry, spot, sigma, cfg.riskFreeRate, 0, multiplier, now, "long", cfg.slippagePct);
  if (leg.premiumTotal > cfg.longPlayBudgetUsd) return null;
  return leg;
}

// ── PMCC (Poor Man's Covered Call) ──────────────────────────────────────────
// Buy a deep-ITM long-dated LEAPS call as a stock surrogate (~0.80 delta), then
// sell short-dated OTM calls against it. Capital = LEAPS debit (≈1/9 of owning
// 100 shares) → run far more concurrent positions on the same book.

// LEAPS leg: long deep-ITM call. Sized like the wheel (multiplier =
// collateralPerContractUsd / strike) so position sizing is comparable across
// strategies. Returns null if the debit exceeds pmccBudgetUsd.
export function selectLeaps(
  underlying: string,
  spot: number,
  sigma: number,
  cfg: OptionsStrategyConfig,
  now = new Date()
): LegSelection | null {
  const expiry = expiryFriday(cfg.pmccLeapsDteMin, cfg.pmccLeapsDteMax, now);
  const t = yearsTo(expiry, now);
  const rawK = strikeForDelta(cfg.pmccLeapsDelta / 100, "C", spot, t, cfg.riskFreeRate, sigma);
  // Deep ITM ⇒ strike below spot. Clamp just under spot if the solver nudges past it.
  let strike = roundStrike(Math.min(rawK, spot));
  if (strike >= spot) strike = roundStrike(spot * 0.99);
  const multiplier = cfg.wholeContracts ? 100 : cfg.collateralPerContractUsd / strike;
  // Debit paid is the capital at risk for the long leg. Whole-contracts mode sizes
  // the budget as a % of account (max leverage while keeping a cash reserve for rolls),
  // still capped by the absolute pmccBudgetUsd ceiling.
  const budget = cfg.wholeContracts
    ? Math.min(cfg.accountSizeUsd * (cfg.pmccBudgetPct / 100), cfg.pmccBudgetUsd)
    : cfg.pmccBudgetUsd;
  const leg = buildLeg(underlying, "C", strike, expiry, spot, sigma, cfg.riskFreeRate, 0, multiplier, now, "long", cfg.slippagePct);
  if (leg.premiumTotal <= 0 || leg.premiumTotal > budget) return null;
  // Record the debit as collateral so the position carries its capital footprint.
  return { ...leg, collateralUsd: leg.premiumTotal };
}

// Short leg of the diagonal: short OTM call covered by the LEAPS (not shares).
// Floor invariant (the PMCC safety rule): shortStrike ≥ leapsStrike + netDebit,
// so even if the short is assigned the diagonal cannot lock a structural loss.
// `leapsUnits` = the LEAPS multiplier → cover exactly, never over/under-write.
export function selectPmccShort(
  underlying: string,
  spot: number,
  leapsStrike: number,
  netDebit: number, // per-unit LEAPS premium paid
  leapsUnits: number,
  sigma: number,
  cfg: OptionsStrategyConfig,
  now = new Date()
): LegSelection {
  // Short leg gets its own DTE window (30-45d standard PMCC practice — max theta
  // capture per roll cycle), NOT the CSP window.
  const expiry = expiryFriday(cfg.shortDteMin, cfg.shortDteMax, now);
  const t = yearsTo(expiry, now);
  const rawK = strikeForDelta(cfg.targetDelta / 100, "C", spot, t, cfg.riskFreeRate, sigma);
  const floor = Math.max(rawK, leapsStrike + netDebit, spot);
  const strike = roundStrike(floor);
  return buildLeg(underlying, "C", strike, expiry, spot, sigma, cfg.riskFreeRate, 0, leapsUnits, now, "short", cfg.slippagePct);
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
  strategy: "csp" | "cc" | "long_call" | "long_put" | "pmcc_leaps" | "pmcc_short",
  strike: number,
  entryPremium: number,
  spotAtExpiry: number,
  contracts: number,
  contractMultiplier: number, // stored value from ai_options_positions.contract_multiplier
  costBasis?: number,         // per-unit basis of held shares (required for cc settlement)
  commissionUsd = 0           // total commissions on this position (open leg; expiry close is free)
): SettleResult {
  const mult = contractMultiplier * contracts;
  const credit = entryPremium * mult;
  const fees = commissionUsd; // always a drag on PnL regardless of side

  // PMCC short call: covered by the LEAPS, no shares change hands. ITM short books
  // a capped loss (premium kept, minus intrinsic); the LEAPS gain offsets at its own
  // settlement. The wheel state stays holding-leaps either way (engine no-ops here).
  if (strategy === "pmcc_short") {
    if (spotAtExpiry > strike) {
      return { status: "called_away", realizedPnl: credit - (spotAtExpiry - strike) * mult - fees };
    }
    return { status: "expired_worthless", realizedPnl: credit - fees };
  }

  if (strategy === "csp") {
    if (spotAtExpiry < strike) {
      return {
        status: "assigned",
        realizedPnl: credit - fees,   // premium income only; basis is full strike
        assignedUnits: mult,
        newCostBasis: strike,
      };
    }
    return { status: "expired_worthless", realizedPnl: credit - fees };
  }

  if (strategy === "cc") {
    if (spotAtExpiry > strike) {
      // Shares called away at strike: premium + capital gain vs cost basis.
      const capitalGain = costBasis != null ? (strike - costBasis) * mult : 0;
      return { status: "called_away", realizedPnl: credit + capitalGain - fees };
    }
    return { status: "expired_worthless", realizedPnl: credit - fees };
  }

  // long options (incl. PMCC LEAPS, a long call): intrinsic at expiry − premium paid
  const isCall = strategy === "long_call" || strategy === "pmcc_leaps";
  const intrinsic = isCall
    ? Math.max(0, spotAtExpiry - strike)
    : Math.max(0, strike - spotAtExpiry);
  return { status: "closed", realizedPnl: intrinsic * mult - credit - fees };
}
