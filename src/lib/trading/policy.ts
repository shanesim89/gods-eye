export const STRATEGY_LIFECYCLES = ["live", "paper", "benched", "retired"] as const;
export type StrategyLifecycle = (typeof STRATEGY_LIFECYCLES)[number];

export const EVIDENCE_CLASSES = [
  "forward",
  "historical_research",
  "legacy_incomplete",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const RECONCILIATION_STATUSES = [
  "reconciled",
  "unreconciled",
  "stale",
  "degraded",
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export type StrategyMode = "paper" | "live";

export type StrategyPolicyInput = {
  lifecycle: StrategyLifecycle;
  mode: StrategyMode;
  entriesEnabled: boolean;
  riskReducingManagementEnabled: boolean;
  reconciliationStatus: ReconciliationStatus;
  reconciliationObservedAt?: Date | null;
  reconciliationMaxAgeMs?: number;
  now?: Date;
  exactExposureMatch?: boolean;
  accountIdentityMatches?: boolean;
  environmentMatches?: boolean;
};

export type PolicyDecision = {
  allowed: boolean;
  reasons: string[];
};

function reconciliationReasons(input: StrategyPolicyInput): string[] {
  const reasons: string[] = [];
  if (input.reconciliationStatus !== "reconciled") {
    reasons.push(`reconciliation_${input.reconciliationStatus}`);
  }
  if (input.exactExposureMatch !== true) reasons.push("exposure_not_exact");
  if (input.accountIdentityMatches !== true) reasons.push("account_identity_mismatch");
  if (input.environmentMatches !== true) reasons.push("broker_environment_mismatch");

  const maxAge = input.reconciliationMaxAgeMs;
  const observedAt = input.reconciliationObservedAt;
  if (maxAge == null || maxAge < 0 || !observedAt) {
    reasons.push("reconciliation_freshness_unknown");
  } else {
    const now = input.now ?? new Date();
    const age = now.getTime() - observedAt.getTime();
    if (!Number.isFinite(age) || age < 0 || age > maxAge) {
      reasons.push("reconciliation_stale");
    }
  }
  return reasons;
}

/** Exposure-adding actions require an explicit entry grant and exact fresh truth. */
export function canAddExposure(input: StrategyPolicyInput): PolicyDecision {
  const reasons: string[] = [];
  if (input.lifecycle !== "paper" && input.lifecycle !== "live") {
    reasons.push(`lifecycle_${input.lifecycle}`);
  }
  if (!input.entriesEnabled) reasons.push("entries_disabled");
  reasons.push(...reconciliationReasons(input));
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/** Management is separate from entry permission and must strictly reduce exposure. */
export function canReduceExposure(
  input: StrategyPolicyInput,
  actionStrictlyReducesExposure: boolean,
): PolicyDecision {
  const reasons: string[] = [];
  if (input.lifecycle !== "paper" && input.lifecycle !== "live") {
    reasons.push(`lifecycle_${input.lifecycle}`);
  }
  if (!input.riskReducingManagementEnabled) reasons.push("management_disabled");
  if (!actionStrictlyReducesExposure) reasons.push("action_not_risk_reducing");
  reasons.push(...reconciliationReasons(input));
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] };
}
