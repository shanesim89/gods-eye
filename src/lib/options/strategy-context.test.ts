import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createStrategyRun: vi.fn(),
  latestValidReconciliation: vi.fn(),
}));

vi.mock("@/lib/trading/ledger", () => mocks);

import {
  ensureOptionsStrategyRun,
  loadOptionsStrategyContext,
  optionsStrategyIdentity,
  resolveOptionsMode,
} from "./strategy-context";

type Settings = Parameters<typeof resolveOptionsMode>[0];

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    user_id: "00000000-0000-4000-8000-000000000002",
    kill_switch: false,
    paper: true,
    entries_enabled: true,
    risk_reducing_management_enabled: true,
    application_mode: "paper",
    broker_environment: "paper",
    broker_account_fingerprint: "alpaca:paper:account-hash",
    reconciliation_max_age_seconds: 300,
    allocated_marked_nlv_limit_usd: "6000",
    max_collateral_usd: "6000",
    long_play_budget_usd: "200",
    long_play_enabled: true,
    target_delta: 22,
    dte_min: 14,
    dte_max: 30,
    conviction_threshold: 75,
    risk_free_rate: "0.0400",
    collateral_per_contract_usd: "500",
    pmcc_leaps_delta: 80,
    pmcc_leaps_dte_min: 180,
    pmcc_leaps_dte_max: 365,
    pmcc_budget_usd: "10000",
    account_size_usd: "10000",
    whole_contracts: false,
    profit_take_pct: 60,
    roll_dte: 21,
    defensive_roll_delta: 40,
    earnings_blackout_days: 3,
    max_positions_per_sector: 2,
    short_dte_min: 30,
    short_dte_max: 45,
    pmcc_budget_pct: 60,
    commission_per_contract: "0.6500",
    slippage_pct: 3,
    leaps_roll_dte: 100,
    pmcc_watchlist: ["SOFI", "F"],
    auto_select_underlying: false,
    underlyings: [{ symbol: "SPY", class: "etf" }],
    last_alert: null,
    updated_at: new Date("2026-08-24T12:00:00.000Z"),
    ...overrides,
  };
}

const USER = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-08-24T12:00:00.000Z");

function reconciliation(overrides: Record<string, unknown> = {}) {
  return {
    id: "snapshot-id",
    user_id: USER,
    run_id: "run-id",
    strategy_key: "ai-options",
    idempotency_key: "reconcile:1",
    broker: "alpaca",
    environment: "paper",
    account_fingerprint: "alpaca:paper:account-hash",
    status: "reconciled",
    difference: "0",
    difference_pct: "0",
    positions: [],
    open_orders: [],
    mismatches: [],
    source: "test",
    snapshot_at: new Date(NOW.getTime() - 60_000),
    valid_until: new Date(NOW.getTime() + 240_000),
    created_at: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.latestValidReconciliation.mockResolvedValue(reconciliation());
  mocks.createStrategyRun.mockResolvedValue(true);
});

describe("options strategy context", () => {
  it("derives a stable run identity from semantic settings", () => {
    const first = settings();
    const second = settings({
      updated_at: new Date("2026-08-25T12:00:00.000Z"),
      last_alert: "informational change",
      entries_enabled: false,
    });

    const firstIdentity = optionsStrategyIdentity(USER, first, "paper");
    const secondIdentity = optionsStrategyIdentity(USER, second, "paper");

    expect(firstIdentity).toEqual(secondIdentity);
    expect(firstIdentity.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("starts a new run when a strategy parameter changes", () => {
    const first = optionsStrategyIdentity(USER, settings(), "paper");
    const second = optionsStrategyIdentity(USER, settings({ target_delta: 30 }), "paper");

    expect(second.parameterHash).not.toBe(first.parameterHash);
    expect(second.runId).not.toBe(first.runId);
  });

  it("fails closed when legacy, application, and broker modes disagree", async () => {
    const inconsistent = settings({
      paper: false,
      application_mode: "live",
      broker_environment: "paper",
    });

    expect(resolveOptionsMode(inconsistent)).toMatchObject({
      valid: false,
      mode: "live",
      brokerEnvironment: "paper",
      reasons: ["application_broker_environment_mismatch"],
    });

    const context = await loadOptionsStrategyContext(USER, inconsistent, { now: NOW });
    expect(context.canAddExposure()).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining(["application_broker_environment_mismatch"]),
    });
    expect(mocks.latestValidReconciliation).not.toHaveBeenCalled();
  });

  it("allows entries only with fresh exact matching reconciliation", async () => {
    const context = await loadOptionsStrategyContext(USER, settings(), { now: NOW });

    expect(context.canAddExposure()).toEqual({ allowed: true, reasons: [] });
    expect(context.canReduceExposure(true)).toEqual({ allowed: true, reasons: [] });
    expect(context.canReduceExposure(false)).toMatchObject({
      allowed: false,
      reasons: ["action_not_risk_reducing"],
    });
  });

  it("denies exposure when reconciliation is absent", async () => {
    mocks.latestValidReconciliation.mockResolvedValue(null);

    const context = await loadOptionsStrategyContext(USER, settings(), { now: NOW });
    expect(context.canAddExposure()).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining([
        "reconciliation_unreconciled",
        "exposure_not_exact",
        "account_identity_mismatch",
        "broker_environment_mismatch",
        "reconciliation_freshness_unknown",
      ]),
    });
  });

  it("checks exposure, account identity, and environment independently", async () => {
    mocks.latestValidReconciliation.mockResolvedValue(reconciliation({
      environment: "live",
      account_fingerprint: "different-account",
      mismatches: [{ kind: "quantity_mismatch" }],
    }));

    const context = await loadOptionsStrategyContext(USER, settings(), { now: NOW });
    expect(context.canAddExposure()).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining([
        "exposure_not_exact",
        "account_identity_mismatch",
        "broker_environment_mismatch",
      ]),
    });
  });

  it("keeps reducing permission separate from entry permission", async () => {
    const context = await loadOptionsStrategyContext(USER, settings({
      entries_enabled: false,
      risk_reducing_management_enabled: true,
    }), { now: NOW });

    expect(context.canAddExposure()).toMatchObject({
      allowed: false,
      reasons: ["entries_disabled"],
    });
    expect(context.canReduceExposure(true)).toEqual({ allowed: true, reasons: [] });
  });

  it("creates the immutable run with the resolved identity", async () => {
    const configured = settings();
    const context = await loadOptionsStrategyContext(USER, configured, { now: NOW });

    await expect(ensureOptionsStrategyRun(USER, configured, context, NOW)).resolves.toBe(true);
    expect(mocks.createStrategyRun).toHaveBeenCalledWith(expect.objectContaining({
      id: context.identity.runId,
      userId: USER,
      strategyKey: "ai-options",
      mode: "paper",
      lifecycle: "paper",
      evidenceClass: "forward",
      inceptionAt: NOW,
      source: "options-engine",
    }));
  });
});
