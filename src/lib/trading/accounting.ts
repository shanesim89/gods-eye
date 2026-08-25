import type { ReconciliationStatus } from "./policy";

const EPSILON = 1e-9;

function finiteNumber(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return value;
}

export type DailyPerformanceInput = {
  openingMarkedNlv: number;
  closingMarkedNlv: number;
  deposits?: number;
  withdrawals?: number;
  otherCashFlows?: number;
  fees?: number;
  spreadCost?: number;
  slippageCost?: number;
  financingFunding?: number;
};

export type DailyPerformance = {
  netCashFlow: number;
  netPnl: number;
  grossPnl: number;
  netReturn: number | null;
  grossReturn: number | null;
  totalCosts: number;
};

/** Same-day marked-NLV performance, excluding external capital movements. */
export function calculateDailyPerformance(input: DailyPerformanceInput): DailyPerformance {
  const opening = finiteNumber(input.openingMarkedNlv, "openingMarkedNlv");
  const closing = finiteNumber(input.closingMarkedNlv, "closingMarkedNlv");
  const deposits = finiteNumber(input.deposits ?? 0, "deposits");
  const withdrawals = finiteNumber(input.withdrawals ?? 0, "withdrawals");
  const otherCashFlows = finiteNumber(input.otherCashFlows ?? 0, "otherCashFlows");
  const fees = finiteNumber(input.fees ?? 0, "fees");
  const spreadCost = finiteNumber(input.spreadCost ?? 0, "spreadCost");
  const slippageCost = finiteNumber(input.slippageCost ?? 0, "slippageCost");
  const financingFunding = finiteNumber(input.financingFunding ?? 0, "financingFunding");

  const netCashFlow = deposits - withdrawals + otherCashFlows;
  const netPnl = closing - opening - netCashFlow;
  const totalCosts = fees + spreadCost + slippageCost + financingFunding;
  const grossPnl = netPnl + totalCosts;

  return {
    netCashFlow,
    netPnl,
    grossPnl,
    netReturn: Math.abs(opening) > EPSILON ? netPnl / opening : null,
    grossReturn: Math.abs(opening) > EPSILON ? grossPnl / opening : null,
    totalCosts,
  };
}

export type ReconciliationCalculation = {
  difference: number;
  differencePct: number | null;
  status: ReconciliationStatus;
};

export function calculateReconciliation(
  expected: number,
  observed: number,
  tolerancePct = 0.005,
): ReconciliationCalculation {
  const expectedValue = finiteNumber(expected, "expected");
  const observedValue = finiteNumber(observed, "observed");
  const tolerance = finiteNumber(tolerancePct, "tolerancePct");
  if (tolerance < 0) throw new Error("tolerancePct must be non-negative");

  const difference = observedValue - expectedValue;
  const denominator = Math.abs(expectedValue);
  const differencePct = denominator > EPSILON
    ? Math.abs(difference) / denominator
    : Math.abs(difference) <= EPSILON
      ? 0
      : null;

  return {
    difference,
    differencePct,
    status: differencePct != null && differencePct <= tolerance
      ? "reconciled"
      : "unreconciled",
  };
}
