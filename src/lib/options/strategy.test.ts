import { describe, it, expect } from "vitest";
import { applySlippage, selectLeaps, selectPmccShort, selectCSP, selectCC, adjustCCDeltaForVerdict, settle } from "./strategy";
import type { OptionsStrategyConfig } from "./strategy";

// Fractional-mode base config with zero slippage/commission so the legacy
// numeric expectations stay exact. Whole-contract tests override below.
const cfg: OptionsStrategyConfig = {
  targetDelta: 22,
  dteMin: 14,
  dteMax: 30,
  riskFreeRate: 0.04,
  convictionThreshold: 70,
  longPlayBudgetUsd: 200,
  collateralPerContractUsd: 500,
  pmccLeapsDelta: 80,
  pmccLeapsDteMin: 180,
  pmccLeapsDteMax: 365,
  pmccBudgetUsd: 2000,
  accountSizeUsd: 10000,
  wholeContracts: false,
  shortDteMin: 30,
  shortDteMax: 45,
  pmccBudgetPct: 60,
  profitTakePct: 60,
  rollDte: 21,
  commissionPerContract: 0,
  slippagePct: 0,
};

const NOW = new Date("2026-06-30T00:00:00Z");

describe("selectLeaps (PMCC long leg)", () => {
  it("picks a deep-ITM call below spot at ~0.80 delta", () => {
    const leaps = selectLeaps("SPY", 600, 0.25, cfg, NOW);
    expect(leaps).not.toBeNull();
    expect(leaps!.optType).toBe("C");
    expect(leaps!.strike).toBeLessThan(600); // ITM
    expect(leaps!.greeks.delta).toBeGreaterThan(0.7);
    expect(leaps!.greeks.delta).toBeLessThan(0.95);
    expect(leaps!.collateralUsd).toBeCloseTo(leaps!.premiumTotal, 2); // debit = capital at risk
  });

  it("is long-dated (≥ pmccLeapsDteMin)", () => {
    const leaps = selectLeaps("SPY", 600, 0.25, cfg, NOW);
    expect(leaps!.dte).toBeGreaterThanOrEqual(cfg.pmccLeapsDteMin);
  });

  it("returns null when the debit exceeds the budget", () => {
    const tight = { ...cfg, pmccBudgetUsd: 1 };
    expect(selectLeaps("SPY", 600, 0.25, tight, NOW)).toBeNull();
  });
});

describe("selectPmccShort (PMCC short leg)", () => {
  it("never sets a strike below leapsStrike + netDebit (floor invariant)", () => {
    const leapsStrike = 560;
    const netDebit = 50; // per-unit debit
    const short = selectPmccShort("SPY", 600, leapsStrike, netDebit, 0.83, 0.25, cfg, NOW);
    expect(short.strike).toBeGreaterThanOrEqual(leapsStrike + netDebit);
  });

  it("covers exactly the LEAPS units", () => {
    const short = selectPmccShort("SPY", 600, 560, 50, 0.83, 0.25, cfg, NOW);
    expect(short.multiplier).toBeCloseTo(0.83, 8);
  });
});

describe("settle — PMCC legs", () => {
  it("pmcc_short expires worthless OTM → keeps full premium", () => {
    const r = settle("pmcc_short", 620, 3.0, 610, 1, 0.8);
    expect(r.status).toBe("expired_worthless");
    expect(r.realizedPnl).toBeCloseTo(3.0 * 0.8, 6);
  });

  it("pmcc_short ITM → called_away, premium minus capped intrinsic", () => {
    const r = settle("pmcc_short", 620, 3.0, 640, 1, 0.8);
    expect(r.status).toBe("called_away");
    // credit 2.4 − intrinsic (640-620)*0.8 = 16 → −13.6
    expect(r.realizedPnl).toBeCloseTo(3.0 * 0.8 - (640 - 620) * 0.8, 6);
  });

  it("pmcc_leaps settles as a long call: intrinsic − debit", () => {
    const r = settle("pmcc_leaps", 560, 50, 640, 1, 0.83);
    expect(r.status).toBe("closed");
    // intrinsic (640-560)*0.83 = 66.4 − debit 50*0.83=41.5 → 24.9
    expect(r.realizedPnl).toBeCloseTo((640 - 560) * 0.83 - 50 * 0.83, 6);
  });

  it("pmcc_leaps worthless if spot below strike at expiry", () => {
    const r = settle("pmcc_leaps", 560, 50, 500, 1, 0.83);
    expect(r.status).toBe("closed");
    expect(r.realizedPnl).toBeCloseTo(-50 * 0.83, 6); // lost the debit
  });
});

// Sanity: existing CSP path unaffected by the new config fields.
describe("regression — wheel CSP still works", () => {
  it("selects an OTM put below spot", () => {
    const csp = selectCSP("SPY", 600, 0.25, cfg, NOW);
    expect(csp).not.toBeNull();
    expect(csp!.optType).toBe("P");
    expect(csp!.strike).toBeLessThan(600);
  });
});

// Lever 2: council verdict previously only ever gated NEW CSP/LEAPS entries —
// a covered call sold unconditionally at a fixed delta regardless of verdict.
describe("adjustCCDeltaForVerdict — council now informs the CC strike too", () => {
  it("HOLD, low confidence, or no verdict leaves the base delta unchanged", () => {
    expect(adjustCCDeltaForVerdict(22, "HOLD", 99, 70)).toBe(22);
    expect(adjustCCDeltaForVerdict(22, "SELL", 50, 70)).toBe(22); // confidence < threshold
    expect(adjustCCDeltaForVerdict(22, undefined, undefined, 70)).toBe(22);
  });

  it("a high-confidence SELL tightens delta toward spot (raise call-away odds, de-risk faster)", () => {
    expect(adjustCCDeltaForVerdict(22, "SELL", 90, 70)).toBe(37); // +15, clamped ≤50
    expect(adjustCCDeltaForVerdict(45, "SELL", 90, 70)).toBe(50); // clamp
  });

  it("a high-confidence BUY loosens delta away from spot (less likely called away from a liked name)", () => {
    expect(adjustCCDeltaForVerdict(22, "BUY", 90, 70)).toBe(14); // -8, clamped ≥8
    expect(adjustCCDeltaForVerdict(10, "BUY", 90, 70)).toBe(8); // clamp
  });
});

describe("selectCC — verdict changes the actual strike, not just the delta number", () => {
  it("SELL produces a strike closer to spot than BUY under otherwise identical inputs", () => {
    const spot = 600;
    const costBasis = 500; // below spot so the floor isn't binding
    const sellCC = selectCC("SPY", spot, costBasis, 1, 0.25, cfg, NOW, "SELL", 90);
    const buyCC = selectCC("SPY", spot, costBasis, 1, 0.25, cfg, NOW, "BUY", 90);
    const holdCC = selectCC("SPY", spot, costBasis, 1, 0.25, cfg, NOW, "HOLD", 90);
    expect(sellCC.strike).toBeLessThan(holdCC.strike);
    expect(buyCC.strike).toBeGreaterThan(holdCC.strike);
  });
});

// ── Whole-contract (live-account realism) mode ────────────────────────────────
const whole: OptionsStrategyConfig = { ...cfg, wholeContracts: true, slippagePct: 3, commissionPerContract: 0.65, pmccBudgetUsd: 1e9 };

describe("whole-contract mode", () => {
  it("CSP sizes at 100 units with strike×100 collateral", () => {
    // cheap underlying so it fits the account
    const csp = selectCSP("SOFI", 20, 0.5, whole, NOW, 10000);
    expect(csp).not.toBeNull();
    expect(csp!.multiplier).toBe(100);
    expect(csp!.collateralUsd).toBeCloseTo(csp!.strike * 100, 6);
  });

  it("CSP returns null when collateral exceeds available cash (SPY on $10k)", () => {
    expect(selectCSP("SPY", 600, 0.25, whole, NOW, 10000)).toBeNull();
  });

  it("LEAPS gates against % of account: SPY Δ80 LEAPS unaffordable on $10k", () => {
    // SPY ~600 → Δ80 LEAPS ≈ $60-90/share → $6-9k debit vs 60% × $10k = $6k budget edge;
    // 560-strike deep ITM at 25% vol prices well above $60 → over budget.
    expect(selectLeaps("SPY", 600, 0.25, whole, NOW)).toBeNull();
  });

  it("LEAPS affordable on a cheap underlying, multiplier=100", () => {
    const leaps = selectLeaps("SOFI", 20, 0.5, whole, NOW);
    expect(leaps).not.toBeNull();
    expect(leaps!.multiplier).toBe(100);
    expect(leaps!.collateralUsd).toBeLessThanOrEqual(10000 * 0.6);
  });

  it("PMCC short uses the 30-45 DTE window, not the CSP window", () => {
    const short = selectPmccShort("SOFI", 20, 14, 7, 100, 0.5, whole, NOW);
    expect(short.dte).toBeGreaterThanOrEqual(30);
    expect(short.dte).toBeLessThanOrEqual(45 + 7); // expiryFriday can overshoot to next Friday
  });

  // Lever 5: pmccBudgetUsd used to double as an absolute ceiling even in
  // whole-contracts mode, where pmccBudgetPct is meant to be the only budget
  // signal. Both defaulting to $10k/60% kept the ceiling a no-op today (60%
  // of $10k = $6k, already under $10k) — but raising account_size_usd without
  // also raising pmcc_budget_usd used to silently cap leverage below the
  // intended 60% the moment accountSize × 0.6 exceeded the ceiling.
  it("a larger account size scales the LEAPS budget with pmccBudgetPct, not silently capped by the (now-fractional-only) pmccBudgetUsd ceiling", () => {
    // account_size_usd raised to $50k, pmcc_budget_usd left at its old $10k
    // default — intended budget is 60% × $50k = $30k. Spot=1000 (a pricier,
    // SPY-like underlying) prices the Δ80 LEAPS debit at ≈$15.2k: ABOVE the
    // old $10k ceiling but WELL under the new $30k pct-budget. Before the
    // lever-5 fix, `min($30k, $10k)`=$10k made this debit unaffordable
    // (returns null); after the fix, budget=$30k and it's affordable — this
    // is the exact scenario the old ceiling would have silently broken.
    const bigAccount: OptionsStrategyConfig = { ...whole, accountSizeUsd: 50000, pmccBudgetUsd: 10000 };
    const leaps = selectLeaps("TEST", 1000, 0.25, bigAccount, NOW);
    expect(leaps).not.toBeNull();
    expect(leaps!.collateralUsd).toBeGreaterThan(10000); // proves the old ceiling isn't binding anymore
    expect(leaps!.collateralUsd).toBeLessThanOrEqual(50000 * 0.6); // still governed by the intended pct
  });
});

describe("fills — slippage and commissions", () => {
  it("short fills receive less than mid, long fills pay more", () => {
    expect(applySlippage(1.0, "short", 3)).toBeCloseTo(0.97, 10);
    expect(applySlippage(1.0, "long", 3)).toBeCloseTo(1.03, 10);
  });

  it("short premium is slippage-haircut vs zero-slippage baseline", () => {
    const noSlip = selectCSP("SOFI", 20, 0.5, { ...whole, slippagePct: 0 }, NOW, 10000);
    const withSlip = selectCSP("SOFI", 20, 0.5, whole, NOW, 10000);
    expect(withSlip!.premium).toBeCloseTo(noSlip!.premium * 0.97, 6);
  });

  it("settle nets commissions from realized PnL on every branch", () => {
    const noFee = settle("pmcc_short", 620, 3.0, 610, 1, 100);
    const fee = settle("pmcc_short", 620, 3.0, 610, 1, 100, undefined, 0.65);
    expect(fee.realizedPnl).toBeCloseTo(noFee.realizedPnl - 0.65, 6);

    const longNoFee = settle("pmcc_leaps", 560, 50, 640, 1, 100);
    const longFee = settle("pmcc_leaps", 560, 50, 640, 1, 100, undefined, 0.65);
    expect(longFee.realizedPnl).toBeCloseTo(longNoFee.realizedPnl - 0.65, 6);
  });
});

describe("profit-take threshold math", () => {
  it("60% profit-take triggers when current ≤ 40% of entry", () => {
    const entry = 2.5;
    const threshold = entry * (1 - 60 / 100);
    expect(threshold).toBeCloseTo(1.0, 10);
    expect(0.99 <= threshold).toBe(true);
    expect(1.01 <= threshold).toBe(false);
  });
});
