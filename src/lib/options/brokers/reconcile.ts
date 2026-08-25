import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_options_positions } from "@/db/schema";
import type { OptionsStrategyContext } from "@/lib/options/strategy-context";
import { recordReconciliationSnapshot } from "@/lib/trading/ledger";
import type { ReconciliationStatus } from "@/lib/trading/policy";
import type { OptionsBroker } from "./broker";
import { brokerAccountFingerprint } from "./account-fingerprint";
import {
  reconcileExactExposure,
  type ReconcileMismatch,
  type ReconciledPosition,
} from "./reconcile-core";

// Reconciles our internal ledger (ai_options_positions) against what Alpaca
// actually holds. Only positions with broker_order_id set were opened via a
// real fill (see broker_order_id's comment in schema.ts) — everything else
// is simulated and has no live counterpart to check.
//
// live-readiness milestone "account_sync" — see scripts/live-readiness-state.json.

export type ReconcileFailureMismatch =
  | { kind: "account_identity_mismatch" }
  | {
      kind: "broker_environment_mismatch";
      expectedEnvironment: string;
      actualEnvironment: string;
    }
  | { kind: "strategy_configuration_invalid"; reasons: string[] }
  | { kind: "application_position_read_failed" }
  | { kind: "broker_position_read_failed" }
  | { kind: "broker_open_order_read_failed" };

export type ReconcileReport = {
  status: ReconciliationStatus;
  dbLiveOpenCount: number;
  brokerPositionCount: number;
  brokerOpenOrderCount: number;
  positions: ReconciledPosition[];
  openOrders: {
    application: [];
    broker: Awaited<ReturnType<OptionsBroker["getOpenOrders"]>>;
  };
  mismatches: Array<ReconcileMismatch | ReconcileFailureMismatch>;
  positionMatch: boolean;
  openOrderMatch: boolean;
  exactExposureMatch: boolean;
  accountIdentityMatches: boolean;
  environmentMatches: boolean;
  clean: boolean;
  snapshotRecorded: boolean;
};

export type ReconcileOptions = {
  broker: OptionsBroker;
  context: OptionsStrategyContext;
  configuredAccountFingerprint: string;
  maxAgeSeconds: number;
  now?: Date;
};

function snapshotIdempotencyKey(
  userId: string,
  options: ReconcileOptions,
  snapshotAt: Date,
): string {
  return createHash("sha256")
    .update([
      userId,
      options.context.identity.strategyKey,
      options.context.identity.runId,
      options.broker.name,
      options.broker.environment,
      snapshotAt.toISOString(),
    ].join("|"))
    .digest("hex");
}

async function applicationPositions(userId: string) {
  const rows = await db
    .select({
      id: ai_options_positions.id,
      contractSymbol: ai_options_positions.contract_symbol,
      side: ai_options_positions.side,
      contracts: ai_options_positions.contracts,
      brokerOrderId: ai_options_positions.broker_order_id,
    })
    .from(ai_options_positions)
    .where(
      and(
        eq(ai_options_positions.user_id, userId),
        eq(ai_options_positions.status, "open"),
        isNotNull(ai_options_positions.broker_order_id),
      ),
    );

  return rows.map((row) => {
    if (row.side !== "long" && row.side !== "short") {
      throw new Error(`Invalid application position side for ${row.id}`);
    }
    if (!Number.isInteger(row.contracts) || row.contracts <= 0) {
      throw new Error(`Invalid application position quantity for ${row.id}`);
    }
    if (!row.brokerOrderId?.trim()) {
      throw new Error(`Invalid broker order boundary for application position ${row.id}`);
    }
    return {
      id: row.id,
      contractSymbol: row.contractSymbol,
      contracts: row.side === "short" ? -row.contracts : row.contracts,
    };
  });
}

export async function reconcileAlpacaPositions(
  userId: string,
  options: ReconcileOptions,
): Promise<ReconcileReport> {
  const snapshotAt = options.now ?? new Date();
  if (Number.isNaN(snapshotAt.getTime())) throw new Error("Invalid reconciliation timestamp");
  if (!Number.isInteger(options.maxAgeSeconds) || options.maxAgeSeconds <= 0) {
    throw new Error("Reconciliation max age must be a positive integer");
  }

  let accountFingerprint: string;
  try {
    const account = await options.broker.getAccount();
    accountFingerprint = brokerAccountFingerprint(
      options.broker.name,
      options.broker.environment,
      account.accountId,
    );
  } catch {
    // Without a stable non-secret account identity there is no safe fingerprint
    // under which to persist even a degraded snapshot.
    throw new Error("Broker account lookup failed");
  }

  const [applicationResult, brokerPositionResult, brokerOrderResult] = await Promise.allSettled([
    applicationPositions(userId),
    options.broker.getPositions(),
    options.broker.getOpenOrders(),
  ]);
  const mismatches: Array<ReconcileMismatch | ReconcileFailureMismatch> = [];
  let positions: ReconciledPosition[] = [];
  let brokerOpenOrders: Awaited<ReturnType<OptionsBroker["getOpenOrders"]>> = [];
  let positionMatch = false;
  let openOrderMatch = false;

  if (applicationResult.status === "rejected") {
    mismatches.push({ kind: "application_position_read_failed" });
  }
  if (brokerPositionResult.status === "rejected") {
    mismatches.push({ kind: "broker_position_read_failed" });
  }
  if (brokerOrderResult.status === "rejected") {
    mismatches.push({ kind: "broker_open_order_read_failed" });
  }

  if (applicationResult.status === "fulfilled" && brokerPositionResult.status === "fulfilled") {
    const positionResult = reconcileExactExposure(
      applicationResult.value,
      brokerPositionResult.value,
      [],
      [],
    );
    positions = positionResult.positions;
    mismatches.push(...positionResult.mismatches);
    positionMatch = positionResult.exactExposureMatch;
  }

  if (brokerOrderResult.status === "fulfilled") {
    brokerOpenOrders = brokerOrderResult.value;
    const orderResult = reconcileExactExposure([], [], [], brokerOpenOrders);
    mismatches.push(...orderResult.mismatches);
    openOrderMatch = orderResult.exactExposureMatch;
  }

  const configuredFingerprint = options.configuredAccountFingerprint.trim();
  const accountIdentityMatches = configuredFingerprint !== ""
    && accountFingerprint === configuredFingerprint;
  const environmentMatches = options.broker.environment === options.context.brokerEnvironment;
  const configurationMatches = options.context.configurationReasons.length === 0;

  if (!accountIdentityMatches) mismatches.push({ kind: "account_identity_mismatch" });
  if (!environmentMatches) {
    mismatches.push({
      kind: "broker_environment_mismatch",
      expectedEnvironment: options.context.brokerEnvironment,
      actualEnvironment: options.broker.environment,
    });
  }
  if (!configurationMatches) {
    mismatches.push({
      kind: "strategy_configuration_invalid",
      reasons: [...options.context.configurationReasons],
    });
  }

  const readsSucceeded = applicationResult.status === "fulfilled"
    && brokerPositionResult.status === "fulfilled"
    && brokerOrderResult.status === "fulfilled";
  const exactExposureMatch = readsSucceeded && positionMatch && openOrderMatch;
  const status: ReconciliationStatus = readsSucceeded
    ? exactExposureMatch && accountIdentityMatches && environmentMatches && configurationMatches
      ? "reconciled"
      : "unreconciled"
    : "degraded";
  const snapshotRecorded = await recordReconciliationSnapshot({
    userId,
    runId: options.context.identity.runId,
    strategyKey: options.context.identity.strategyKey,
    idempotencyKey: snapshotIdempotencyKey(userId, options, snapshotAt),
    broker: options.broker.name,
    environment: options.broker.environment,
    accountFingerprint,
    status,
    positions,
    openOrders: { application: [], broker: brokerOpenOrders },
    mismatches,
    source: "options-engine",
    snapshotAt,
    validUntil: new Date(snapshotAt.getTime() + options.maxAgeSeconds * 1_000),
  });

  return {
    status,
    dbLiveOpenCount: applicationResult.status === "fulfilled" ? applicationResult.value.length : 0,
    brokerPositionCount: brokerPositionResult.status === "fulfilled"
      ? brokerPositionResult.value.length
      : 0,
    brokerOpenOrderCount: brokerOpenOrders.length,
    positions,
    openOrders: { application: [], broker: brokerOpenOrders },
    mismatches,
    positionMatch,
    openOrderMatch,
    exactExposureMatch,
    accountIdentityMatches,
    environmentMatches,
    clean: status === "reconciled",
    snapshotRecorded,
  };
}
