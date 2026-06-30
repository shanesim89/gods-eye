import { describe, it, expect } from "vitest";
import { selectLeaps, selectPmccShort, selectCSP, settle } from "./strategy";
import type { OptionsStrategyConfig } from "./strategy";

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
    expect(csp.optType).toBe("P");
    expect(csp.strike).toBeLessThan(600);
  });
});
