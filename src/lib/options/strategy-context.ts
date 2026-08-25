import "server-only";
import { createHash } from "node:crypto";
import type { ai_options_settings } from "@/db/schema";
import {
  createStrategyRun,
  latestValidReconciliation,
} from "@/lib/trading/ledger";
import {
  canAddExposure,
  canReduceExposure,
  RECONCILIATION_STATUSES,
  type EvidenceClass,
  type PolicyDecision,
  type ReconciliationStatus,
  type StrategyLifecycle,
  type StrategyMode,
  type StrategyPolicyInput,
} from "@/lib/trading/policy";

export const OPTIONS_STRATEGY_KEY = "ai-options";
export const OPTIONS_IMPLEMENTATION_VERSION = "options-engine-v1";
export const OPTIONS_PARAMETER_VERSION = "settings-v1";
export const OPTIONS_STRATEGY_SOURCE = "options-engine";

type OptionsSettings = typeof ai_options_settings.$inferSelect;
type ReconciliationSnapshot = NonNullable<Awaited<ReturnType<typeof latestValidReconciliation>>>;

const OPERATIONAL_SETTING_KEYS = new Set<keyof OptionsSettings>([
  "user_id",
  "kill_switch",
  "paper",
  "entries_enabled",
  "risk_reducing_management_enabled",
  "application_mode",
  "broker_environment",
  "broker_account_fingerprint",
  "reconciliation_max_age_seconds",
  "last_alert",
  "updated_at",
]);

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(value: string): string {
  const bytes = Buffer.from(sha256(value).slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function strategyParameters(settings: OptionsSettings): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !OPERATIONAL_SETTING_KEYS.has(key as keyof OptionsSettings)),
  );
}

export type OptionsStrategyIdentity = {
  strategyKey: typeof OPTIONS_STRATEGY_KEY;
  runId: string;
  implementationVersion: typeof OPTIONS_IMPLEMENTATION_VERSION;
  parameterVersion: typeof OPTIONS_PARAMETER_VERSION;
  parameterHash: string;
};

export function optionsStrategyIdentity(
  userId: string,
  settings: OptionsSettings,
  mode: StrategyMode,
): OptionsStrategyIdentity {
  const parameters = canonicalize(strategyParameters(settings));
  const parameterHash = sha256(JSON.stringify(parameters));
  const runId = deterministicUuid([
    userId,
    OPTIONS_STRATEGY_KEY,
    OPTIONS_IMPLEMENTATION_VERSION,
    OPTIONS_PARAMETER_VERSION,
    parameterHash,
    mode,
  ].join("|"));

  return {
    strategyKey: OPTIONS_STRATEGY_KEY,
    runId,
    implementationVersion: OPTIONS_IMPLEMENTATION_VERSION,
    parameterVersion: OPTIONS_PARAMETER_VERSION,
    parameterHash,
  };
}

export type OptionsModeResolution = {
  valid: boolean;
  mode: StrategyMode;
  brokerEnvironment: StrategyMode;
  reasons: string[];
};

/** Resolves legacy and current mode settings without permitting contradictory state. */
export function resolveOptionsMode(settings: OptionsSettings): OptionsModeResolution {
  const reasons: string[] = [];
  const applicationMode = settings.application_mode;
  const brokerEnvironment = settings.broker_environment;
  const applicationValid = applicationMode === "paper" || applicationMode === "live";
  const environmentValid = brokerEnvironment === "paper" || brokerEnvironment === "live";
  const legacyMode: StrategyMode = settings.paper ? "paper" : "live";

  if (!applicationValid) reasons.push("application_mode_invalid");
  if (!environmentValid) reasons.push("broker_environment_invalid");
  if (applicationValid && applicationMode !== legacyMode) {
    reasons.push("legacy_application_mode_mismatch");
  }
  if (applicationValid && environmentValid && applicationMode !== brokerEnvironment) {
    reasons.push("application_broker_environment_mismatch");
  }

  return {
    valid: reasons.length === 0,
    mode: applicationValid ? applicationMode : "paper",
    brokerEnvironment: environmentValid ? brokerEnvironment : "paper",
    reasons,
  };
}

function reconciliationStatus(snapshot: ReconciliationSnapshot | null): ReconciliationStatus {
  if (!snapshot) return "unreconciled";
  return RECONCILIATION_STATUSES.includes(snapshot.status as ReconciliationStatus)
    ? snapshot.status as ReconciliationStatus
    : "degraded";
}

function exactExposureMatch(snapshot: ReconciliationSnapshot | null): boolean {
  if (!snapshot || snapshot.status !== "reconciled") return false;
  return Array.isArray(snapshot.mismatches) && snapshot.mismatches.length === 0;
}

function combineDecision(decision: PolicyDecision, reasons: string[]): PolicyDecision {
  const allReasons = [...new Set([...reasons, ...decision.reasons])];
  return { allowed: allReasons.length === 0, reasons: allReasons };
}

export type OptionsStrategyContext = {
  identity: OptionsStrategyIdentity;
  mode: StrategyMode;
  lifecycle: StrategyLifecycle;
  evidenceClass: EvidenceClass;
  brokerEnvironment: StrategyMode;
  configurationReasons: string[];
  reconciliation: ReconciliationSnapshot | null;
  policyInput: StrategyPolicyInput;
  canAddExposure(): PolicyDecision;
  canReduceExposure(actionStrictlyReducesExposure: boolean): PolicyDecision;
};

export type LoadOptionsStrategyContextOptions = {
  now?: Date;
  lifecycle?: StrategyLifecycle;
  evidenceClass?: EvidenceClass;
};

export async function loadOptionsStrategyContext(
  userId: string,
  settings: OptionsSettings,
  options: LoadOptionsStrategyContextOptions = {},
): Promise<OptionsStrategyContext> {
  const now = options.now ?? new Date();
  const modeResolution = resolveOptionsMode(settings);
  const identity = optionsStrategyIdentity(userId, settings, modeResolution.mode);
  const lifecycle = options.lifecycle ?? modeResolution.mode;
  const evidenceClass = options.evidenceClass ?? "forward";
  const maxAgeSeconds = settings.reconciliation_max_age_seconds;
  const configuredFingerprint = settings.broker_account_fingerprint?.trim() ?? "";
  const configurationReasons = [...modeResolution.reasons];

  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    configurationReasons.push("reconciliation_max_age_invalid");
  }
  if (!configuredFingerprint) {
    configurationReasons.push("broker_account_fingerprint_missing");
  }

  const reconciliation = modeResolution.valid
    ? await latestValidReconciliation(userId, identity.runId, identity.strategyKey, now)
    : null;
  const status = reconciliationStatus(reconciliation);
  const policyInput: StrategyPolicyInput = {
    lifecycle,
    mode: modeResolution.mode,
    entriesEnabled: settings.entries_enabled === true,
    riskReducingManagementEnabled: settings.risk_reducing_management_enabled === true,
    reconciliationStatus: status,
    reconciliationObservedAt: reconciliation?.snapshot_at ?? null,
    reconciliationMaxAgeMs: Number.isInteger(maxAgeSeconds) && maxAgeSeconds > 0
      ? maxAgeSeconds * 1_000
      : undefined,
    now,
    exactExposureMatch: exactExposureMatch(reconciliation),
    accountIdentityMatches: Boolean(
      configuredFingerprint
      && reconciliation
      && reconciliation.account_fingerprint === configuredFingerprint,
    ),
    environmentMatches: Boolean(
      modeResolution.valid
      && reconciliation
      && reconciliation.environment === modeResolution.brokerEnvironment,
    ),
  };

  return {
    identity,
    mode: modeResolution.mode,
    lifecycle,
    evidenceClass,
    brokerEnvironment: modeResolution.brokerEnvironment,
    configurationReasons: [...new Set(configurationReasons)],
    reconciliation,
    policyInput,
    canAddExposure: () => combineDecision(canAddExposure(policyInput), configurationReasons),
    canReduceExposure: (strictlyReduces) => combineDecision(
      canReduceExposure(policyInput, strictlyReduces),
      configurationReasons,
    ),
  };
}

export async function ensureOptionsStrategyRun(
  userId: string,
  settings: OptionsSettings,
  context: OptionsStrategyContext,
  inceptionAt = new Date(),
): Promise<boolean> {
  if (context.configurationReasons.length > 0) return false;
  return createStrategyRun({
    id: context.identity.runId,
    userId,
    strategyKey: context.identity.strategyKey,
    implementationVersion: context.identity.implementationVersion,
    parameterVersion: context.identity.parameterVersion,
    parameterHash: context.identity.parameterHash,
    mode: context.mode,
    lifecycle: context.lifecycle,
    evidenceClass: context.evidenceClass,
    inceptionAt,
    source: OPTIONS_STRATEGY_SOURCE,
    metadata: {
      brokerEnvironment: context.brokerEnvironment,
      parameters: canonicalize(strategyParameters(settings)),
    },
  });
}
