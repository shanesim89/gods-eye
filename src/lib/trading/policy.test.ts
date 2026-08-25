import { describe, expect, it } from "vitest";
import { canAddExposure, canReduceExposure, type StrategyPolicyInput } from "./policy";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function reconciledPolicy(overrides: Partial<StrategyPolicyInput> = {}): StrategyPolicyInput {
  return {
    lifecycle: "paper",
    mode: "paper",
    entriesEnabled: true,
    riskReducingManagementEnabled: true,
    reconciliationStatus: "reconciled",
    reconciliationObservedAt: new Date("2026-08-24T11:59:00.000Z"),
    reconciliationMaxAgeMs: 5 * 60 * 1000,
    now: NOW,
    exactExposureMatch: true,
    accountIdentityMatches: true,
    environmentMatches: true,
    ...overrides,
  };
}

describe("strategy policy", () => {
  it("allows exposure only with an explicit entry grant and fresh exact truth", () => {
    expect(canAddExposure(reconciledPolicy())).toEqual({ allowed: true, reasons: [] });
  });

  it("fails closed when entry reconciliation details are absent", () => {
    const decision = canAddExposure({
      lifecycle: "paper",
      mode: "paper",
      entriesEnabled: true,
      riskReducingManagementEnabled: false,
      reconciliationStatus: "reconciled",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      "exposure_not_exact",
      "account_identity_mismatch",
      "broker_environment_mismatch",
      "reconciliation_freshness_unknown",
    ]));
  });

  it("denies stale or future-dated reconciliation", () => {
    expect(canAddExposure(reconciledPolicy({
      reconciliationObservedAt: new Date("2026-08-24T11:54:59.999Z"),
    })).reasons).toContain("reconciliation_stale");

    expect(canAddExposure(reconciledPolicy({
      reconciliationObservedAt: new Date("2026-08-24T12:00:01.000Z"),
    })).reasons).toContain("reconciliation_stale");
  });

  it("keeps management independent from entry permission", () => {
    const policy = reconciledPolicy({ entriesEnabled: false });
    expect(canAddExposure(policy).allowed).toBe(false);
    expect(canReduceExposure(policy, true)).toEqual({ allowed: true, reasons: [] });
  });

  it("denies management that does not strictly reduce exposure", () => {
    const decision = canReduceExposure(reconciledPolicy(), false);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("action_not_risk_reducing");
  });

  it("blocks benched and retired strategies", () => {
    expect(canAddExposure(reconciledPolicy({ lifecycle: "benched" })).reasons)
      .toContain("lifecycle_benched");
    expect(canReduceExposure(reconciledPolicy({ lifecycle: "retired" }), true).reasons)
      .toContain("lifecycle_retired");
  });
});
