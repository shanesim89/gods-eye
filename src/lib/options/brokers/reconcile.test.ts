import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionsBroker } from "./broker";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  recordReconciliationSnapshot: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/trading/ledger", () => ({
  recordReconciliationSnapshot: mocks.recordReconciliationSnapshot,
}));

const { reconcileAlpacaPositions } = await import("./reconcile");
const { brokerAccountFingerprint } = await import("./account-fingerprint");

const USER = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-08-24T12:00:00.000Z");

function context(overrides: Record<string, unknown> = {}) {
  return {
    identity: {
      strategyKey: "ai-options",
      runId: "00000000-0000-5000-8000-000000000001",
      implementationVersion: "options-engine-v1",
      parameterVersion: "settings-v1",
      parameterHash: "parameter-hash",
    },
    mode: "paper",
    lifecycle: "paper",
    evidenceClass: "forward",
    brokerEnvironment: "paper",
    configurationReasons: [],
    reconciliation: null,
    policyInput: {} as never,
    canAddExposure: vi.fn(),
    canReduceExposure: vi.fn(),
    ...overrides,
  } as never;
}

function broker(overrides: Partial<OptionsBroker> = {}): OptionsBroker {
  return {
    name: "alpaca",
    environment: "paper",
    getAccount: vi.fn().mockResolvedValue({
      accountId: "ACCOUNT-123",
      cashUsd: 1000,
      buyingPowerUsd: 2000,
      equityUsd: 1500,
    }),
    getPositions: vi.fn().mockResolvedValue([]),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    cancelAllOrders: vi.fn(),
    getOptionActivities: vi.fn(),
    ...overrides,
  };
}

function setApplicationRows(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  mocks.select.mockReturnValue({ from });
}

function options(instance: OptionsBroker, overrides: Record<string, unknown> = {}) {
  return {
    broker: instance,
    context: context(),
    configuredAccountFingerprint: brokerAccountFingerprint(
      instance.name,
      instance.environment,
      "ACCOUNT-123",
    ),
    maxAgeSeconds: 300,
    now: NOW,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  setApplicationRows([]);
  mocks.recordReconciliationSnapshot.mockResolvedValue(true);
});

describe("reconcileAlpacaPositions", () => {
  it("records exact signed aggregate exposure scoped to the strategy run", async () => {
    setApplicationRows([
      { id: "app-1", contractSymbol: "SPY260918P00500000", side: "short", contracts: 1, brokerOrderId: "fill-1" },
      { id: "app-2", contractSymbol: "SPY260918P00500000", side: "short", contracts: 2, brokerOrderId: "fill-2" },
    ]);
    const instance = broker({
      getPositions: vi.fn().mockResolvedValue([
        { contractSymbol: "SPY260918P00500000", contracts: -1, avgEntryPrice: 1.25 },
        { contractSymbol: "SPY260918P00500000", contracts: -2, avgEntryPrice: 1.30 },
      ]),
    });

    const report = await reconcileAlpacaPositions(USER, options(instance));

    expect(report).toMatchObject({
      status: "reconciled",
      positionMatch: true,
      openOrderMatch: true,
      exactExposureMatch: true,
      accountIdentityMatches: true,
      environmentMatches: true,
      clean: true,
    });
    expect(report.positions).toEqual([{
      contractSymbol: "SPY260918P00500000",
      applicationContracts: -3,
      brokerContracts: -3,
      difference: 0,
      applicationPositionIds: ["app-1", "app-2"],
    }]);
    expect(mocks.recordReconciliationSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER,
      runId: "00000000-0000-5000-8000-000000000001",
      strategyKey: "ai-options",
      status: "reconciled",
      source: "options-engine",
      snapshotAt: NOW,
      validUntil: new Date("2026-08-24T12:05:00.000Z"),
    }));
  });

  it("treats every broker open order as unexpected", async () => {
    const instance = broker({
      getOpenOrders: vi.fn().mockResolvedValue([{
        brokerOrderId: "pending-1",
        contractSymbol: "SPY260918P00500000",
        side: "sell_to_open",
        contracts: 1,
      }]),
    });

    const report = await reconcileAlpacaPositions(USER, options(instance));

    expect(report.status).toBe("unreconciled");
    expect(report.positionMatch).toBe(true);
    expect(report.openOrderMatch).toBe(false);
    expect(report.mismatches).toContainEqual({
      kind: "unexpected_order_at_broker",
      brokerOrderId: "pending-1",
      contractSymbol: "SPY260918P00500000",
      side: "sell_to_open",
      contracts: 1,
    });
    expect(mocks.recordReconciliationSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      openOrders: {
        application: [],
        broker: [expect.objectContaining({ brokerOrderId: "pending-1" })],
      },
    }));
  });

  it("records degraded evidence after identity succeeds and a later read fails", async () => {
    const instance = broker({
      getPositions: vi.fn().mockRejectedValue(new Error("broker position read failed")),
    });

    const report = await reconcileAlpacaPositions(USER, options(instance));

    expect(report.status).toBe("degraded");
    expect(report.exactExposureMatch).toBe(false);
    expect(report.mismatches).toContainEqual({ kind: "broker_position_read_failed" });
    expect(mocks.recordReconciliationSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      status: "degraded",
      accountFingerprint: brokerAccountFingerprint("alpaca", "paper", "ACCOUNT-123"),
    }));
  });

  it("does not persist or fabricate identity when account lookup fails", async () => {
    const instance = broker({
      getAccount: vi.fn().mockRejectedValue(new Error("credentials and broker payload")),
    });

    await expect(reconcileAlpacaPositions(USER, options(instance))).rejects.toThrow(
      "Broker account lookup failed",
    );
    expect(instance.getPositions).not.toHaveBeenCalled();
    expect(instance.getOpenOrders).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.recordReconciliationSnapshot).not.toHaveBeenCalled();
  });

  it("compares account identity and environment independently", async () => {
    const instance = broker({ environment: "live" });

    const report = await reconcileAlpacaPositions(USER, options(instance, {
      context: context({ brokerEnvironment: "paper" }),
      configuredAccountFingerprint: "different-account",
    }));

    expect(report.status).toBe("unreconciled");
    expect(report.exactExposureMatch).toBe(true);
    expect(report.accountIdentityMatches).toBe(false);
    expect(report.environmentMatches).toBe(false);
    expect(report.mismatches).toEqual(expect.arrayContaining([
      { kind: "account_identity_mismatch" },
      {
        kind: "broker_environment_mismatch",
        expectedEnvironment: "paper",
        actualEnvironment: "live",
      },
    ]));
  });
});
