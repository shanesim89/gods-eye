import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const state = {
    inserted: [] as unknown[],
    selected: [] as unknown[],
  };
  const insertBuilder = {
    values: vi.fn(),
    onConflictDoNothing: vi.fn(),
    returning: vi.fn(),
  };
  insertBuilder.values.mockReturnValue(insertBuilder);
  insertBuilder.onConflictDoNothing.mockReturnValue(insertBuilder);
  insertBuilder.returning.mockImplementation(async () => state.inserted);

  const selectBuilder = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  selectBuilder.from.mockReturnValue(selectBuilder);
  selectBuilder.where.mockReturnValue(selectBuilder);
  selectBuilder.orderBy.mockReturnValue(selectBuilder);
  selectBuilder.limit.mockImplementation(async () => state.selected);

  return {
    state,
    insertBuilder,
    selectBuilder,
    db: {
      insert: vi.fn(() => insertBuilder),
      select: vi.fn(() => selectBuilder),
    },
  };
});

vi.mock("@/db/client", () => ({ db: mocks.db }));

import {
  appendStrategyEvent,
  createStrategyRun,
  latestValidReconciliation,
  recordDailyObservation,
  recordReconciliationSnapshot,
} from "./ledger";

const RUN = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  strategyKey: "quant",
  implementationVersion: "2",
  parameterVersion: "reduced-risk-v1",
  parameterHash: "hash",
  mode: "paper" as const,
  lifecycle: "paper" as const,
  evidenceClass: "forward" as const,
  inceptionAt: new Date("2026-08-24T00:00:00.000Z"),
  source: "test",
};

beforeEach(() => {
  mocks.state.inserted = [];
  mocks.state.selected = [];
  vi.clearAllMocks();
});

describe("immutable strategy ledger persistence", () => {
  it("creates a run once without updating an existing identity", async () => {
    mocks.state.inserted = [{ id: RUN.id }];
    await expect(createStrategyRun(RUN)).resolves.toBe(true);
    expect(mocks.insertBuilder.onConflictDoNothing).toHaveBeenCalledTimes(1);

    mocks.state.inserted = [];
    await expect(createStrategyRun(RUN)).resolves.toBe(false);
  });

  it("uses event idempotency keys and preserves run-ending events", async () => {
    mocks.state.inserted = [{ id: "event-id" }];
    await expect(appendStrategyEvent({
      userId: RUN.userId,
      runId: RUN.id,
      strategyKey: RUN.strategyKey,
      eventType: "run_end",
      idempotencyKey: `${RUN.id}:run-end`,
      eventAt: new Date("2026-08-25T00:00:00.000Z"),
      priceProvenance: "journaled",
      source: "test",
      evidenceClass: "forward",
      detail: { reason: "retired" },
    })).resolves.toBe(true);

    expect(mocks.insertBuilder.values).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "run_end",
      idempotency_key: `${RUN.id}:run-end`,
    }));
    expect(mocks.insertBuilder.onConflictDoNothing).toHaveBeenCalledTimes(1);

    mocks.state.inserted = [];
    await expect(appendStrategyEvent({
      userId: RUN.userId,
      runId: RUN.id,
      strategyKey: RUN.strategyKey,
      eventType: "run_end",
      idempotencyKey: `${RUN.id}:run-end`,
      eventAt: new Date("2026-08-25T00:00:00.000Z"),
      priceProvenance: "journaled",
      source: "test",
      evidenceClass: "forward",
    })).resolves.toBe(false);
  });

  it("allows only one immutable observation per run and UTC day", async () => {
    const input = {
      userId: RUN.userId,
      strategyKey: RUN.strategyKey,
      runId: RUN.id,
      day: "2026-08-24",
      openingMarkedNlv: 10_000,
      closingMarkedNlv: 10_100,
      grossRealizedPnl: 110,
      netRealizedPnl: 100,
      unrealizedPnl: 0,
      reconciliationStatus: "reconciled" as const,
      activityCount: 2,
      source: "test",
      evidenceClass: "forward" as const,
      observedAt: new Date("2026-08-25T00:00:00.000Z"),
    };

    mocks.state.inserted = [{ runId: RUN.id }];
    await expect(recordDailyObservation(input)).resolves.toBe(true);
    expect(mocks.insertBuilder.onConflictDoNothing).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.any(Array),
    }));

    mocks.state.inserted = [];
    await expect(recordDailyObservation(input)).resolves.toBe(false);
  });

  it("rejects malformed days, invalid counts, and non-finite amounts", async () => {
    const base = {
      userId: RUN.userId,
      strategyKey: RUN.strategyKey,
      runId: RUN.id,
      day: "2026-08-24",
      openingMarkedNlv: 10_000,
      closingMarkedNlv: 10_000,
      grossRealizedPnl: 0,
      netRealizedPnl: 0,
      unrealizedPnl: 0,
      reconciliationStatus: "reconciled" as const,
      source: "test",
      evidenceClass: "forward" as const,
      observedAt: new Date("2026-08-25T00:00:00.000Z"),
    };

    await expect(recordDailyObservation({ ...base, day: "08/24/2026" }))
      .rejects.toThrow("day must use YYYY-MM-DD");
    await expect(recordDailyObservation({ ...base, activityCount: -1 }))
      .rejects.toThrow("activityCount must be a non-negative integer");
    await expect(recordDailyObservation({ ...base, closingMarkedNlv: Number.NaN }))
      .rejects.toThrow("closingMarkedNlv must be finite");
    expect(mocks.insertBuilder.onConflictDoNothing).not.toHaveBeenCalled();
  });

  it("validates and idempotently appends reconciliation snapshots", async () => {
    const snapshotAt = new Date("2026-08-24T12:00:00.000Z");
    const validUntil = new Date("2026-08-24T12:05:00.000Z");
    const input = {
      userId: RUN.userId,
      runId: RUN.id,
      strategyKey: RUN.strategyKey,
      idempotencyKey: `${RUN.id}:reconciliation:1`,
      broker: "alpaca",
      environment: "paper",
      accountFingerprint: "non-secret-fingerprint",
      status: "reconciled" as const,
      positions: [],
      openOrders: [],
      mismatches: [],
      source: "test",
      snapshotAt,
      validUntil,
    };

    mocks.state.inserted = [{ id: "snapshot-id" }];
    await expect(recordReconciliationSnapshot(input)).resolves.toBe(true);
    mocks.state.inserted = [];
    await expect(recordReconciliationSnapshot(input)).resolves.toBe(false);

    await expect(recordReconciliationSnapshot({
      ...input,
      validUntil: new Date(snapshotAt.getTime() - 1),
    })).rejects.toThrow("validUntil must not precede snapshotAt");
  });

  it("marks the latest reconciliation stale after its validity window", async () => {
    const snapshot = {
      id: "snapshot-id",
      status: "reconciled",
      valid_until: new Date("2026-08-24T12:05:00.000Z"),
    };
    mocks.state.selected = [snapshot];

    await expect(latestValidReconciliation(
      RUN.userId,
      RUN.id,
      RUN.strategyKey,
      new Date("2026-08-24T12:05:01.000Z"),
    )).resolves.toEqual({ ...snapshot, status: "stale" });
  });
});
