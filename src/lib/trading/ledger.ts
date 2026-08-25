import "server-only";
import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  strategy_daily_observations,
  strategy_events,
  strategy_reconciliation_snapshots,
  strategy_runs,
} from "@/db/schema";
import type {
  EvidenceClass,
  ReconciliationStatus,
  StrategyLifecycle,
  StrategyMode,
} from "./policy";

export { calculateDailyPerformance, calculateReconciliation } from "./accounting";

type NumericInput = number | string;

function finiteNumber(value: NumericInput, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be finite`);
  return parsed;
}

function decimal(value: NumericInput, field: string): string {
  return finiteNumber(value, field).toString();
}

export type CreateStrategyRunInput = {
  id: string;
  userId: string;
  strategyKey: string;
  implementationVersion: string;
  parameterVersion: string;
  parameterHash: string;
  mode: StrategyMode;
  lifecycle: StrategyLifecycle;
  evidenceClass: EvidenceClass;
  inceptionAt: Date;
  endedAt?: Date | null;
  source: string;
  metadata?: unknown;
};

export async function createStrategyRun(input: CreateStrategyRunInput): Promise<boolean> {
  const inserted = await db
    .insert(strategy_runs)
    .values({
      id: input.id,
      user_id: input.userId,
      strategy_key: input.strategyKey,
      implementation_version: input.implementationVersion,
      parameter_version: input.parameterVersion,
      parameter_hash: input.parameterHash,
      mode: input.mode,
      lifecycle: input.lifecycle,
      evidence_class: input.evidenceClass,
      inception_at: input.inceptionAt,
      ended_at: input.endedAt ?? null,
      source: input.source,
      metadata: input.metadata ?? null,
    })
    .onConflictDoNothing({ target: strategy_runs.id })
    .returning({ id: strategy_runs.id });
  return inserted.length === 1;
}

export type StrategyEventType =
  | "order_intent"
  | "execution"
  | "fill"
  | "trade"
  | "cash_flow"
  | "run_end";

export type AppendStrategyEventInput = {
  userId: string;
  runId: string;
  strategyKey: string;
  eventType: StrategyEventType;
  idempotencyKey: string;
  eventAt: Date;
  parentTradeId?: string | null;
  pairId?: string | null;
  legId?: string | null;
  symbol?: string | null;
  side?: string | null;
  quantity?: NumericInput | null;
  price?: NumericInput | null;
  grossAmount?: NumericInput | null;
  fees?: NumericInput;
  spreadCost?: NumericInput;
  slippageCost?: NumericInput;
  financingFunding?: NumericInput;
  currency?: string;
  quoteSource?: string | null;
  quoteAt?: Date | null;
  priceProvenance: "executable" | "modeled" | "journaled";
  brokerReference?: string | null;
  source: string;
  evidenceClass: EvidenceClass;
  detail?: unknown;
};

/** Returns false for an already-recorded idempotency key; existing evidence is never changed. */
export async function appendStrategyEvent(input: AppendStrategyEventInput): Promise<boolean> {
  const inserted = await db
    .insert(strategy_events)
    .values({
      user_id: input.userId,
      run_id: input.runId,
      strategy_key: input.strategyKey,
      event_type: input.eventType,
      idempotency_key: input.idempotencyKey,
      event_at: input.eventAt,
      parent_trade_id: input.parentTradeId ?? null,
      pair_id: input.pairId ?? null,
      leg_id: input.legId ?? null,
      symbol: input.symbol ?? null,
      side: input.side ?? null,
      quantity: input.quantity == null ? null : decimal(input.quantity, "quantity"),
      price: input.price == null ? null : decimal(input.price, "price"),
      gross_amount: input.grossAmount == null ? null : decimal(input.grossAmount, "grossAmount"),
      fees: decimal(input.fees ?? 0, "fees"),
      spread_cost: decimal(input.spreadCost ?? 0, "spreadCost"),
      slippage_cost: decimal(input.slippageCost ?? 0, "slippageCost"),
      financing_funding: decimal(input.financingFunding ?? 0, "financingFunding"),
      currency: input.currency ?? "USD",
      quote_source: input.quoteSource ?? null,
      quote_at: input.quoteAt ?? null,
      price_provenance: input.priceProvenance,
      broker_reference: input.brokerReference ?? null,
      source: input.source,
      evidence_class: input.evidenceClass,
      detail: input.detail ?? null,
    })
    .onConflictDoNothing({ target: strategy_events.idempotency_key })
    .returning({ id: strategy_events.id });
  return inserted.length === 1;
}

export type RecordDailyObservationInput = {
  userId: string;
  strategyKey: string;
  runId: string;
  day: string;
  openingMarkedNlv: NumericInput;
  closingMarkedNlv: NumericInput;
  grossRealizedPnl: NumericInput;
  netRealizedPnl: NumericInput;
  unrealizedPnl: NumericInput;
  grossReturn?: NumericInput | null;
  netReturn?: NumericInput | null;
  fees?: NumericInput;
  spreadCost?: NumericInput;
  slippageCost?: NumericInput;
  financingFunding?: NumericInput;
  cashFlows?: NumericInput;
  deposits?: NumericInput;
  withdrawals?: NumericInput;
  grossExposure?: NumericInput;
  netExposure?: NumericInput;
  drawdown?: NumericInput | null;
  benchmarkReturn?: NumericInput | null;
  volatilityMatchedBenchmarkReturn?: NumericInput | null;
  reconciliationStatus: ReconciliationStatus;
  reconciliationDifference?: NumericInput | null;
  reconciliationDifferencePct?: NumericInput | null;
  activityCount?: number;
  source: string;
  evidenceClass: EvidenceClass;
  observedAt: Date;
};

/** Inserts exactly one immutable observation per user/strategy/run/UTC day. */
export async function recordDailyObservation(input: RecordDailyObservationInput): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new Error("day must use YYYY-MM-DD");
  if (!Number.isInteger(input.activityCount ?? 0) || (input.activityCount ?? 0) < 0) {
    throw new Error("activityCount must be a non-negative integer");
  }

  const inserted = await db
    .insert(strategy_daily_observations)
    .values({
      user_id: input.userId,
      strategy_key: input.strategyKey,
      run_id: input.runId,
      day: input.day,
      opening_marked_nlv: decimal(input.openingMarkedNlv, "openingMarkedNlv"),
      closing_marked_nlv: decimal(input.closingMarkedNlv, "closingMarkedNlv"),
      gross_realized_pnl: decimal(input.grossRealizedPnl, "grossRealizedPnl"),
      net_realized_pnl: decimal(input.netRealizedPnl, "netRealizedPnl"),
      unrealized_pnl: decimal(input.unrealizedPnl, "unrealizedPnl"),
      gross_return: input.grossReturn == null ? null : decimal(input.grossReturn, "grossReturn"),
      net_return: input.netReturn == null ? null : decimal(input.netReturn, "netReturn"),
      fees: decimal(input.fees ?? 0, "fees"),
      spread_cost: decimal(input.spreadCost ?? 0, "spreadCost"),
      slippage_cost: decimal(input.slippageCost ?? 0, "slippageCost"),
      financing_funding: decimal(input.financingFunding ?? 0, "financingFunding"),
      cash_flows: decimal(input.cashFlows ?? 0, "cashFlows"),
      deposits: decimal(input.deposits ?? 0, "deposits"),
      withdrawals: decimal(input.withdrawals ?? 0, "withdrawals"),
      gross_exposure: decimal(input.grossExposure ?? 0, "grossExposure"),
      net_exposure: decimal(input.netExposure ?? 0, "netExposure"),
      drawdown: input.drawdown == null ? null : decimal(input.drawdown, "drawdown"),
      benchmark_return: input.benchmarkReturn == null ? null : decimal(input.benchmarkReturn, "benchmarkReturn"),
      volatility_matched_benchmark_return: input.volatilityMatchedBenchmarkReturn == null
        ? null
        : decimal(input.volatilityMatchedBenchmarkReturn, "volatilityMatchedBenchmarkReturn"),
      reconciliation_status: input.reconciliationStatus,
      reconciliation_difference: input.reconciliationDifference == null
        ? null
        : decimal(input.reconciliationDifference, "reconciliationDifference"),
      reconciliation_difference_pct: input.reconciliationDifferencePct == null
        ? null
        : decimal(input.reconciliationDifferencePct, "reconciliationDifferencePct"),
      activity_count: input.activityCount ?? 0,
      source: input.source,
      evidence_class: input.evidenceClass,
      observed_at: input.observedAt,
    })
    .onConflictDoNothing({
      target: [
        strategy_daily_observations.user_id,
        strategy_daily_observations.strategy_key,
        strategy_daily_observations.run_id,
        strategy_daily_observations.day,
      ],
    })
    .returning({ runId: strategy_daily_observations.run_id });
  return inserted.length === 1;
}

export type RecordReconciliationSnapshotInput = {
  userId: string;
  runId: string;
  strategyKey: string;
  idempotencyKey: string;
  broker: string;
  environment: string;
  accountFingerprint: string;
  status: ReconciliationStatus;
  difference?: NumericInput | null;
  differencePct?: NumericInput | null;
  positions: unknown;
  openOrders: unknown;
  mismatches: unknown;
  source: string;
  snapshotAt: Date;
  validUntil: Date;
};

export async function recordReconciliationSnapshot(
  input: RecordReconciliationSnapshotInput,
): Promise<boolean> {
  if (input.validUntil.getTime() < input.snapshotAt.getTime()) {
    throw new Error("validUntil must not precede snapshotAt");
  }
  const inserted = await db
    .insert(strategy_reconciliation_snapshots)
    .values({
      user_id: input.userId,
      run_id: input.runId,
      strategy_key: input.strategyKey,
      idempotency_key: input.idempotencyKey,
      broker: input.broker,
      environment: input.environment,
      account_fingerprint: input.accountFingerprint,
      status: input.status,
      difference: input.difference == null ? null : decimal(input.difference, "difference"),
      difference_pct: input.differencePct == null ? null : decimal(input.differencePct, "differencePct"),
      positions: input.positions,
      open_orders: input.openOrders,
      mismatches: input.mismatches,
      source: input.source,
      snapshot_at: input.snapshotAt,
      valid_until: input.validUntil,
    })
    .onConflictDoNothing({ target: strategy_reconciliation_snapshots.idempotency_key })
    .returning({ id: strategy_reconciliation_snapshots.id });
  return inserted.length === 1;
}

export async function latestValidReconciliation(
  userId: string,
  runId: string,
  strategyKey: string,
  at = new Date(),
) {
  const rows = await db
    .select()
    .from(strategy_reconciliation_snapshots)
    .where(and(
      eq(strategy_reconciliation_snapshots.user_id, userId),
      eq(strategy_reconciliation_snapshots.run_id, runId),
      eq(strategy_reconciliation_snapshots.strategy_key, strategyKey),
      lte(strategy_reconciliation_snapshots.snapshot_at, at),
    ))
    .orderBy(desc(strategy_reconciliation_snapshots.snapshot_at))
    .limit(1);

  const snapshot = rows[0] ?? null;
  if (!snapshot) return null;
  if (snapshot.valid_until.getTime() < at.getTime()) {
    return { ...snapshot, status: "stale" as const };
  }
  return snapshot;
}
