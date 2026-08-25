import { describe, expect, it } from "vitest";
import { calculateDailyPerformance, calculateReconciliation } from "./accounting";

describe("daily performance accounting", () => {
  it("removes external cash flows from same-day marked-NLV profit", () => {
    const result = calculateDailyPerformance({
      openingMarkedNlv: 10_000,
      closingMarkedNlv: 10_650,
      deposits: 1_000,
      withdrawals: 250,
      otherCashFlows: -50,
      fees: 10,
      spreadCost: 5,
      slippageCost: 3,
      financingFunding: 2,
    });

    expect(result.netCashFlow).toBe(700);
    expect(result.netPnl).toBe(-50);
    expect(result.totalCosts).toBe(20);
    expect(result.grossPnl).toBe(-30);
    expect(result.netReturn).toBe(-0.005);
    expect(result.grossReturn).toBe(-0.003);
  });

  it("returns null returns for zero opening NLV", () => {
    expect(calculateDailyPerformance({
      openingMarkedNlv: 0,
      closingMarkedNlv: 10,
    })).toMatchObject({ netReturn: null, grossReturn: null });
  });

  it("rejects non-finite inputs", () => {
    expect(() => calculateDailyPerformance({
      openingMarkedNlv: Number.NaN,
      closingMarkedNlv: 10,
    })).toThrow("openingMarkedNlv must be finite");
  });
});

describe("reconciliation accounting", () => {
  it("reconciles at the configured tolerance boundary", () => {
    expect(calculateReconciliation(10_000, 10_050, 0.005)).toEqual({
      difference: 50,
      differencePct: 0.005,
      status: "reconciled",
    });
  });

  it("marks values outside tolerance unreconciled", () => {
    expect(calculateReconciliation(10_000, 10_050.01, 0.005).status)
      .toBe("unreconciled");
  });

  it("handles a zero expected NLV without inventing a percentage", () => {
    expect(calculateReconciliation(0, 0)).toEqual({
      difference: 0,
      differencePct: 0,
      status: "reconciled",
    });
    expect(calculateReconciliation(0, 1)).toEqual({
      difference: 1,
      differencePct: null,
      status: "unreconciled",
    });
  });

  it("rejects a negative tolerance", () => {
    expect(() => calculateReconciliation(1, 1, -0.01))
      .toThrow("tolerancePct must be non-negative");
  });
});
