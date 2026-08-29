// Orchestration tests for runOptionsForUser / manageOptionsPositionsForUser —
// the part of the options bot with ZERO prior test coverage (strategy.ts's
// pure math is tested; the gate ordering, state transitions, and idempotency
// that actually decide whether/when a trade fires were not). Uses an
// in-memory fake for `db` (see ./fakeDb.ts) so real engine.ts control flow
// runs without a Postgres connection — collaborators (price feed, council,
// screener) are mocked directly since they're tested/testable elsewhere.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionsStrategyContext } from "../strategy-context";
import type { Store, Row } from "./fakeDb";

const hoisted = vi.hoisted(() => ({
  store: null as Store | null,
  context: null as Record<string, unknown> | null,
  loadContext: vi.fn(),
  ensureRun: vi.fn(),
  reconcile: vi.fn(),
  alpacaConstructor: vi.fn(),
  appendIntent: vi.fn(),
  appendExecution: vi.fn(),
  appendFill: vi.fn(),
  appendLifecycle: vi.fn(),
  broker: {
    name: "alpaca",
    environment: "paper" as "paper" | "live",
    getAccount: vi.fn(),
    getPositions: vi.fn(),
    getOpenOrders: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    cancelAllOrders: vi.fn(),
    getOptionActivities: vi.fn(),
  },
}));

// engine.ts (and its DB/council imports) are marked `import "server-only"` —
// a Next.js build-time guard that throws outside the Next server bundler.
// No-op it so these modules can be unit-tested directly under vitest/node.
vi.mock("server-only", () => ({}));

vi.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, val: unknown) => (row: Row) => row[col.name] === val,
  lte: (col: { name: string }, val: unknown) => (row: Row) =>
    new Date(row[col.name] as string).getTime() <= new Date(val as string).getTime(),
  isNull: (col: { name: string }) => (row: Row) => row[col.name] == null,
  isNotNull: (col: { name: string }) => (row: Row) => row[col.name] != null,
  and: (...preds: Array<(row: Row) => boolean>) => (row: Row) => preds.every((p) => p(row)),
  sql: Object.assign(
    (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const col = values.find((v) => v && typeof v === "object" && "name" in v) as
        | { name: string }
        | undefined;
      return { __aggSum: col?.name ?? "" };
    },
    { raw: (s: string) => s }
  ),
}));

vi.mock("@/db/client", async () => {
  const schema = await import("@/db/schema");
  const { makeStore, makeFakeDb, registerTables } = await import("./fakeDb");
  const store = makeStore();
  hoisted.store = store;
  registerTables({
    ai_options_settings: schema.ai_options_settings,
    ai_options_wheel: schema.ai_options_wheel,
    ai_options_positions: schema.ai_options_positions,
    ai_options_orders: schema.ai_options_orders,
  });
  return { db: makeFakeDb(store) };
});

vi.mock("../strategy-context", () => ({
  loadOptionsStrategyContext: (...args: unknown[]) => hoisted.loadContext(...args),
  ensureOptionsStrategyRun: (...args: unknown[]) => hoisted.ensureRun(...args),
}));

vi.mock("../brokers/reconcile", () => ({
  reconcileAlpacaPositions: (...args: unknown[]) => hoisted.reconcile(...args),
}));

vi.mock("../brokers/alpaca", () => ({
  AlpacaBroker: class {
    constructor(environment: "paper" | "live") {
      hoisted.alpacaConstructor(environment);
      hoisted.broker.environment = environment;
      return hoisted.broker;
    }
  },
}));

vi.mock("../strategy-ledger", () => ({
  appendOptionOrderIntent: (...args: unknown[]) => hoisted.appendIntent(...args),
  appendOptionExecution: (...args: unknown[]) => hoisted.appendExecution(...args),
  appendOptionFillTradeCashFlow: (...args: unknown[]) => hoisted.appendFill(...args),
  appendOptionLifecycle: (...args: unknown[]) => hoisted.appendLifecycle(...args),
}));

const getPrice = vi.fn();
const getPriceHistory = vi.fn();
vi.mock("@/lib/market", () => ({ getPrice: (...a: unknown[]) => getPrice(...a), getPriceHistory: (...a: unknown[]) => getPriceHistory(...a) }));

const runCouncil = vi.fn();
vi.mock("@/lib/council/run", () => ({ runCouncil: (...a: unknown[]) => runCouncil(...a) }));

vi.mock("@/lib/options/screener", () => ({
  screenPmccCandidates: vi.fn(async () => ({ ranked: [], errors: [] })),
  isTransientScreenerResult: vi.fn(() => false),
}));

const getYahooOptions = vi.fn();
const getYahooSummary = vi.fn();
vi.mock("@/lib/yahoo", () => ({
  getYahooOptions: (...a: unknown[]) => getYahooOptions(...a),
  getYahooSummary: (...a: unknown[]) => getYahooSummary(...a),
}));

// Deribit is a live public HTTP endpoint — mocked so crypto tests never hit it.
const fetchDeribitCSPQuote = vi.fn();
vi.mock("../deribit-chain", () => ({
  fetchDeribitCSPQuote: (...a: unknown[]) => fetchDeribitCSPQuote(...a),
  fetchDeribitCCQuote: vi.fn(async () => null),
}));

const { runOptionsForUser, manageOptionsPositionsForUser } = await import("../engine");

const USER = "11111111-1111-1111-1111-111111111111";
const TEST_ACCOUNT_FINGERPRINT = "test-fixture:alpaca:paper:account-001";

function allowedContext(
  overrides: Partial<OptionsStrategyContext> = {},
): OptionsStrategyContext {
  const now = new Date();
  const allowed = { allowed: true, reasons: [] };
  const context: OptionsStrategyContext = {
    identity: {
      strategyKey: "ai-options",
      runId: "22222222-2222-5222-8222-222222222222",
      implementationVersion: "options-engine-v1",
      parameterVersion: "settings-v1",
      parameterHash: "test-parameter-hash",
    },
    mode: "paper",
    lifecycle: "paper",
    evidenceClass: "forward",
    brokerEnvironment: "paper",
    configurationReasons: [],
    reconciliation: {
      id: "test-reconciliation-id",
      user_id: USER,
      run_id: "22222222-2222-5222-8222-222222222222",
      strategy_key: "ai-options",
      idempotency_key: "test-reconciliation-key",
      broker: "alpaca",
      environment: "paper",
      account_fingerprint: TEST_ACCOUNT_FINGERPRINT,
      status: "reconciled",
      difference: "0",
      difference_pct: "0",
      positions: [],
      open_orders: [],
      mismatches: [],
      source: "test",
      snapshot_at: now,
      valid_until: new Date(now.getTime() + 300_000),
      created_at: now,
    },
    policyInput: {
      lifecycle: "paper",
      mode: "paper",
      entriesEnabled: true,
      riskReducingManagementEnabled: true,
      reconciliationStatus: "reconciled",
      reconciliationObservedAt: now,
      reconciliationMaxAgeMs: 300_000,
      now,
      exactExposureMatch: true,
      accountIdentityMatches: true,
      environmentMatches: true,
    },
    canAddExposure: () => allowed,
    canReduceExposure: () => allowed,
  };
  return { ...context, ...overrides };
}

function verdict(v: "BUY" | "HOLD" | "SELL", confidence: number) {
  return { verdict: v, confidence, summary: "", agents: [], generatedAt: new Date().toISOString() };
}

function baseSettings(overrides: Partial<Row> = {}): Row {
  return {
    user_id: USER,
    kill_switch: false,
    paper: true,
    entries_enabled: true,
    risk_reducing_management_enabled: true,
    application_mode: "paper",
    broker_environment: "paper",
    broker_account_fingerprint: TEST_ACCOUNT_FINGERPRINT,
    reconciliation_max_age_seconds: 300,
    max_collateral_usd: "200000",
    long_play_budget_usd: "200",
    long_play_enabled: false, // off by default — most tests aren't exercising this path
    target_delta: 22,
    dte_min: 14,
    dte_max: 30,
    conviction_threshold: 75,
    risk_free_rate: "0.04",
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
    commission_per_contract: "0.65",
    slippage_pct: 3,
    leaps_roll_dte: 100,
    pmcc_watchlist: [],
    auto_select_underlying: false,
    underlyings: [{ symbol: "SPY", class: "etf" }],
    last_alert: null,
    updated_at: new Date(),
    ...overrides,
  };
}

function wheelRow(underlying: string, overrides: Partial<Row> = {}): Row {
  return {
    user_id: USER,
    underlying,
    state: "cash",
    shares: "0",
    cost_basis: null,
    leaps_strike: null,
    leaps_expiry: null,
    leaps_net_debit: null,
    leaps_units: null,
    leaps_contract_symbol: null,
    next_run_at: null,
    updated_at: new Date(),
    ...overrides,
  };
}

function positionRow(overrides: Partial<Row> = {}): Row {
  return {
    id: `pos_${Math.random().toString(36).slice(2)}`,
    user_id: USER,
    underlying: "SPY",
    asset_class: "etf",
    strategy: "csp",
    side: "short",
    contract_symbol: "SPY-TEST",
    strike: "500",
    expiry: new Date(Date.now() + 20 * 86_400_000),
    opt_type: "P",
    contracts: 1,
    contract_multiplier: "0.676",
    entry_premium: "5",
    entry_spot: "510",
    collateral_usd: "500",
    greeks: null,
    council_verdict: null,
    council_confidence: null,
    status: "open",
    realized_pnl: null,
    exit_reason: null,
    exit_premium: null,
    opened_at: new Date(),
    settled_at: null,
    ...overrides,
  };
}

function store(): Store {
  if (!hoisted.store) throw new Error("fake db not initialized");
  return hoisted.store;
}

beforeEach(() => {
  const s = store();
  for (const k of Object.keys(s)) s[k] = [];

  hoisted.context = allowedContext();
  hoisted.loadContext.mockReset();
  hoisted.loadContext.mockImplementation(async () => hoisted.context);
  hoisted.ensureRun.mockReset();
  hoisted.ensureRun.mockResolvedValue(true);
  hoisted.reconcile.mockReset();
  hoisted.reconcile.mockResolvedValue({ status: "reconciled" });
  hoisted.alpacaConstructor.mockReset();
  hoisted.appendIntent.mockReset();
  hoisted.appendIntent.mockResolvedValue(true);
  hoisted.appendExecution.mockReset();
  hoisted.appendExecution.mockResolvedValue(true);
  hoisted.appendFill.mockReset();
  hoisted.appendFill.mockResolvedValue(undefined);
  hoisted.appendLifecycle.mockReset();
  hoisted.appendLifecycle.mockResolvedValue(undefined);
  hoisted.broker.environment = "paper";
  hoisted.broker.getAccount.mockReset();
  hoisted.broker.getAccount.mockResolvedValue({
    id: "test-alpaca-account-001",
    environment: "paper",
  });
  hoisted.broker.getPositions.mockReset();
  hoisted.broker.getPositions.mockResolvedValue([]);
  hoisted.broker.getOpenOrders.mockReset();
  hoisted.broker.getOpenOrders.mockResolvedValue([]);
  hoisted.broker.placeOrder.mockReset();
  hoisted.broker.placeOrder.mockResolvedValue({
    brokerOrderId: "test-broker-order-001",
    status: "filled",
    filledPrice: 1,
    filledContracts: 1,
  });
  hoisted.broker.cancelOrder.mockReset();
  hoisted.broker.cancelOrder.mockResolvedValue(undefined);
  hoisted.broker.cancelAllOrders.mockReset();
  hoisted.broker.cancelAllOrders.mockResolvedValue(undefined);
  hoisted.broker.getOptionActivities.mockReset();
  hoisted.broker.getOptionActivities.mockResolvedValue([]);

  getPrice.mockReset();
  getPriceHistory.mockReset();
  runCouncil.mockReset();
  getYahooOptions.mockReset();
  getYahooSummary.mockReset();
  fetchDeribitCSPQuote.mockReset();
  fetchDeribitCSPQuote.mockResolvedValue(null);
  // Default: no real chain available — every CSP/CC test falls back to the
  // pre-existing BS-off-HV path unless it explicitly opts into a real quote.
  getYahooOptions.mockResolvedValue(null);
  // Default: no fundamentals — earnings-blackout/ex-div/sector gates stay
  // inert (heuristic fallback) unless a test explicitly opts in.
  getYahooSummary.mockResolvedValue(null);
  // Default: 30d history implies noticeably higher vol than the 252d fallback,
  // so ivVsHv's proxy percentile clears the 40% IVR gate by default — tests
  // not specifically exercising that gate shouldn't incidentally trip it.
  // (With both windows falling back to the SAME value, ratio=1 always yields
  // proxyPctile≈33%, which is < 40 and would silently skip everything.)
  getPriceHistory.mockImplementation(async (_symbol: string, days: number) =>
    days === 30 ? Array.from({ length: 30 }, (_, i) => 100 * (i % 2 === 0 ? 1.08 : 0.92)) : null
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runOptionsForUser — guardrails", () => {
  it("kill_switch halts before any DB writes or price/council calls", async () => {
    store().ai_options_settings.push(baseSettings({ kill_switch: true }));
    const result = await runOptionsForUser(USER);
    expect(result).toEqual({ ran: false, reason: "kill_switch active", outcomes: [] });
    expect(getPrice).not.toHaveBeenCalled();
    expect(runCouncil).not.toHaveBeenCalled();
    expect(store().ai_options_positions).toHaveLength(0);
  });

  it("no settings row → ran:false, no crash", async () => {
    const result = await runOptionsForUser(USER);
    expect(result.ran).toBe(false);
    expect(result.reason).toMatch(/no options settings/);
  });

  it("weekly idempotency: a plain rerun the same week is 'not due'; a forced rerun still can't double-open", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));

    const first = await runOptionsForUser(USER);
    expect(first.outcomes.find((o) => o.status === "opened_csp")).toBeTruthy();
    expect(store().ai_options_positions).toHaveLength(1);

    // Plain rerun: next_run_at was advanced +7d by the first run, so this is
    // correctly gated by "due", not idempotency — the due-check runs first.
    const second = await runOptionsForUser(USER);
    expect(second.outcomes[0]).toMatchObject({ status: "skipped", reason: "not due" });

    // Forced rerun (bypasses "due"): the weekly idempotency claim is the
    // remaining safety net and must still prevent a duplicate CSP.
    const third = await runOptionsForUser(USER, { force: true });
    expect(third.outcomes[0]).toMatchObject({ status: "skipped", reason: "already processed this week" });
    expect(store().ai_options_positions).toHaveLength(1); // no duplicate
  });

  it("not due (next_run_at in the future) skips unless force:true", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(
      wheelRow("SPY", { state: "cash", next_run_at: new Date(Date.now() + 3 * 86_400_000) })
    );
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));

    const notDue = await runOptionsForUser(USER);
    expect(notDue.outcomes[0]).toMatchObject({ status: "skipped", reason: "not due" });
    expect(store().ai_options_positions).toHaveLength(0);

    const forced = await runOptionsForUser(USER, { force: true });
    expect(forced.outcomes.find((o) => o.status === "opened_csp")).toBeTruthy();
  });

  it("no price for underlying (feed hiccup) rolls the weekly claim back so the next run retries", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "cash" }));
    getPrice.mockResolvedValue(null);
    runCouncil.mockResolvedValue(verdict("HOLD", 50));

    const first = await runOptionsForUser(USER);
    expect(first.outcomes[0].reason).toMatch(/transient/);
    expect(store().ai_options_orders).toHaveLength(0); // claim rolled back

    // Next run (price now available) is NOT blocked by a stale claim.
    getPrice.mockResolvedValue({ price: 510 });
    const second = await runOptionsForUser(USER, { force: true });
    expect(second.outcomes.find((o) => o.status === "opened_csp")).toBeTruthy();
  });
});

describe("runOptionsForUser — modeled weekly recovery", () => {
  function arrangeModeledCsp() {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
  }

  it("releases the weekly claim when initial action authorization denies before intent", async () => {
    arrangeModeledCsp();
    const allowed = { allowed: true, reasons: [] };
    const denied = { allowed: false, reasons: ["reconciliation_stale"] };
    const canAddExposure = vi.fn()
      .mockReturnValueOnce(allowed) // runtime bootstrap
      .mockReturnValueOnce(denied) // modeled action intent
      .mockReturnValue(allowed);
    hoisted.context = allowedContext({ canAddExposure });

    const first = await runOptionsForUser(USER);

    expect(first.outcomes).toContainEqual(expect.objectContaining({
      status: "skipped",
      reason: expect.stringContaining("reconciliation_stale"),
    }));
    expect(hoisted.appendIntent).not.toHaveBeenCalled();
    expect(hoisted.appendExecution).not.toHaveBeenCalled();
    expect(hoisted.appendFill).not.toHaveBeenCalled();
    expect(store().ai_options_positions).toHaveLength(0);
    expect(store().ai_options_orders).toHaveLength(0);

    const retry = await runOptionsForUser(USER, { force: true });
    expect(retry.outcomes).toContainEqual(expect.objectContaining({ status: "opened_csp" }));
    expect(store().ai_options_positions).toHaveLength(1);
  });

  it("releases the weekly claim when final authorization denies directly before insertion", async () => {
    arrangeModeledCsp();
    const allowed = { allowed: true, reasons: [] };
    const denied = { allowed: false, reasons: ["exact_exposure_mismatch"] };
    const canAddExposure = vi.fn()
      .mockReturnValueOnce(allowed) // runtime bootstrap
      .mockReturnValueOnce(allowed) // modeled action intent
      .mockReturnValueOnce(denied) // final pre-insert check
      .mockReturnValue(allowed);
    hoisted.context = allowedContext({ canAddExposure });

    const first = await runOptionsForUser(USER);

    expect(first.outcomes).toContainEqual(expect.objectContaining({
      status: "skipped",
      reason: expect.stringContaining("exact_exposure_mismatch"),
    }));
    expect(hoisted.appendIntent).toHaveBeenCalledTimes(1);
    expect(hoisted.appendExecution).not.toHaveBeenCalled();
    expect(hoisted.appendFill).not.toHaveBeenCalled();
    expect(store().ai_options_positions).toHaveLength(0);
    expect(store().ai_options_orders).toHaveLength(0);

    const retry = await runOptionsForUser(USER, { force: true });
    expect(retry.outcomes).toContainEqual(expect.objectContaining({ status: "opened_csp" }));
    expect(store().ai_options_positions).toHaveLength(1);
  });

  it("releases the weekly claim when intent evidence fails before exposure mutation", async () => {
    arrangeModeledCsp();
    hoisted.appendIntent.mockRejectedValueOnce(new Error("intent ledger unavailable"));

    const first = await runOptionsForUser(USER);

    expect(first.outcomes).toContainEqual(expect.objectContaining({
      status: "failed",
      reason: "intent ledger unavailable",
    }));
    expect(store().ai_options_positions).toHaveLength(0);
    expect(store().ai_options_orders).toHaveLength(0);
    expect(hoisted.appendExecution).not.toHaveBeenCalled();
    expect(hoisted.appendFill).not.toHaveBeenCalled();

    const retry = await runOptionsForUser(USER, { force: true });
    expect(retry.outcomes).toContainEqual(expect.objectContaining({ status: "opened_csp" }));
    expect(store().ai_options_positions).toHaveLength(1);
  });

  it("preserves the weekly claim when execution evidence fails after insertion", async () => {
    arrangeModeledCsp();
    hoisted.appendExecution.mockRejectedValueOnce(new Error("execution ledger unavailable"));

    const first = await runOptionsForUser(USER);

    expect(first.outcomes).toContainEqual(expect.objectContaining({
      status: "failed",
      reason: expect.stringContaining("weekly claim preserved"),
    }));
    expect(store().ai_options_positions).toHaveLength(1);
    expect(store().ai_options_orders).toHaveLength(1);
    expect(hoisted.appendFill).not.toHaveBeenCalled();

    const retry = await runOptionsForUser(USER, { force: true });
    expect(retry.outcomes).toContainEqual(expect.objectContaining({
      status: "skipped",
      reason: "already processed this week",
    }));
    expect(store().ai_options_positions).toHaveLength(1);
  });

  it("preserves the weekly claim when fill evidence fails after insertion", async () => {
    arrangeModeledCsp();
    hoisted.appendFill.mockRejectedValueOnce(new Error("fill ledger unavailable"));

    const first = await runOptionsForUser(USER);

    expect(first.outcomes).toContainEqual(expect.objectContaining({
      status: "failed",
      reason: expect.stringContaining("weekly claim preserved"),
    }));
    expect(store().ai_options_positions).toHaveLength(1);
    expect(store().ai_options_orders).toHaveLength(1);
    expect(hoisted.appendExecution).toHaveBeenCalledTimes(1);

    const retry = await runOptionsForUser(USER, { force: true });
    expect(retry.outcomes).toContainEqual(expect.objectContaining({
      status: "skipped",
      reason: "already processed this week",
    }));
    expect(store().ai_options_positions).toHaveLength(1);
  });
});

describe("runOptionsForUser — council gate is asymmetric (documents the audit finding)", () => {
  it("a high-confidence SELL skips opening a NEW CSP", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("SELL", 90));

    const result = await runOptionsForUser(USER);
    expect(result.outcomes[0]).toMatchObject({ status: "skipped" });
    expect(result.outcomes[0].reason).toMatch(/SELL signal/);
    expect(store().ai_options_positions).toHaveLength(0);
  });

  it("a high-confidence SELL does NOT stop a covered call from being sold on held shares", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(
      wheelRow("SPY", { state: "holding_stock", shares: "1.96", cost_basis: "500" })
    );
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("SELL", 99)); // strongest possible bearish signal

    const result = await runOptionsForUser(USER);
    const opened = result.outcomes.find((o) => o.status === "opened_cc");
    expect(opened).toBeTruthy(); // CC fires unconditionally — the asymmetry
    expect(store().ai_options_positions).toHaveLength(1);
    expect(store().ai_options_positions[0].strategy).toBe("cc");
  });

  it("a BUY/HOLD verdict lets a new CSP open normally", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("BUY", 80));

    const result = await runOptionsForUser(USER);
    expect(result.outcomes.find((o) => o.status === "opened_csp")).toBeTruthy();
  });
});

describe("runOptionsForUser — IVR gate", () => {
  it("skips selling premium (CSP) when the proxy says IV is cheap", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    // 30d history implies low vol, 252d implies much higher → proxy percentile low.
    getPriceHistory.mockImplementation(async (_symbol: string, days: number) =>
      days === 30
        ? Array.from({ length: 30 }, (_, i) => 100 + i * 0.001) // ~flat, near-zero realized vol
        : Array.from({ length: 252 }, (_, i) => 100 + Math.sin(i) * 20) // wide swings
    );

    const result = await runOptionsForUser(USER);
    expect(result.outcomes[0]).toMatchObject({ status: "skipped" });
    expect(result.outcomes[0].reason).toMatch(/cheap IV/);
    expect(store().ai_options_positions).toHaveLength(0);
  });

  it("does NOT gate buying a LEAPS (pmcc_cash) even when IV would look cheap", async () => {
    store().ai_options_settings.push(
      baseSettings({ underlyings: [{ symbol: "SOFI", class: "equity", mode: "pmcc" }] })
    );
    store().ai_options_wheel.push(wheelRow("SOFI", { state: "pmcc_cash" }));
    getPrice.mockResolvedValue({ price: 10 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    getPriceHistory.mockImplementation(async (_symbol: string, days: number) =>
      days === 30
        ? Array.from({ length: 30 }, (_, i) => 10 + i * 0.0001)
        : Array.from({ length: 252 }, (_, i) => 10 + Math.sin(i) * 3)
    );

    const result = await runOptionsForUser(USER);
    // Should reach the LEAPS-buy path, not get halted by the IVR gate.
    expect(result.outcomes[0].status).not.toBe("skipped");
  });
});

describe("runOptionsForUser — collateral cap", () => {
  it("skips a new CSP once open collateral + the new one would exceed max_collateral_usd", async () => {
    store().ai_options_settings.push(baseSettings({ max_collateral_usd: "400" })); // < $500 default CSP collateral
    store().ai_options_wheel.push(wheelRow("SPY", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));

    const result = await runOptionsForUser(USER);
    expect(result.outcomes[0]).toMatchObject({ status: "skipped", reason: "collateral cap reached" });
    expect(store().ai_options_positions).toHaveLength(0);
  });

  it("counts CSP collateral opened earlier in the same run", async () => {
    store().ai_options_settings.push(baseSettings({
      max_collateral_usd: "750",
      underlyings: [
        { symbol: "SPY", class: "etf" },
        { symbol: "QQQ", class: "etf" },
      ],
    }));
    store().ai_options_wheel.push(
      wheelRow("SPY", { state: "cash" }),
      wheelRow("QQQ", { state: "cash" })
    );
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));

    const result = await runOptionsForUser(USER);

    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ underlying: "SPY", status: "opened_csp" }),
      expect.objectContaining({ underlying: "QQQ", status: "skipped", reason: "collateral cap reached" }),
    ]));
    expect(store().ai_options_positions).toHaveLength(1);
    expect(store().ai_options_positions[0]).toMatchObject({
      underlying: "SPY",
      collateral_usd: "500.00",
    });
  });
});

// Minimal NormalizedChain fixture — one row is enough since nearestRow() with
// a single candidate always returns it regardless of exact strike distance,
// so these tests don't need to replicate wheel-chain.ts's strikeForDelta math.
const REAL_EXP_SEC = Math.floor((Date.now() + 25 * 86_400_000) / 1000);
function realChainFixture(putRow?: Row, callRow?: Row) {
  return {
    source: "yahoo",
    underlying: "SPY",
    underlyingPrice: 510,
    expiry: REAL_EXP_SEC,
    expirations: [REAL_EXP_SEC],
    strikes: [putRow?.strike, callRow?.strike].filter((s) => s != null),
    calls: callRow ? [callRow] : [],
    puts: putRow ? [putRow] : [],
  };
}

describe("runOptionsForUser — real-chain pricing (lever 1)", () => {
  it("uses a real chain quote for a new CSP when liquid — real bid becomes entry_premium, not the BS price", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    getYahooOptions.mockResolvedValue(
      realChainFixture({
        strike: 480, lastPrice: 3, bid: 2.8, ask: 3.2, volume: 500, openInterest: 800,
        impliedVolatility: 0.22, inTheMoney: false,
      })
    );

    const result = await runOptionsForUser(USER);
    const opened = result.outcomes.find((o) => o.status === "opened_csp");
    expect(opened).toBeTruthy();
    expect(opened?.detail).toMatchObject({ source: "real", strike: 480 });
    expect(store().ai_options_positions[0].entry_premium).toBe("2.8000"); // real bid, not a BS-model price
  });

  it("falls back to the BS model when the real chain exists but fails the liquidity filter (low OI)", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    getYahooOptions.mockResolvedValue(
      realChainFixture({
        strike: 480, lastPrice: 3, bid: 2.8, ask: 3.2, volume: 5, openInterest: 5, // < the 50 OI floor
        impliedVolatility: 0.22, inTheMoney: false,
      })
    );

    const result = await runOptionsForUser(USER);
    const opened = result.outcomes.find((o) => o.status === "opened_csp");
    expect(opened).toBeTruthy();
    expect(opened?.detail).toMatchObject({ source: "model" });
  });

  it("uses a real chain quote for a covered call when liquid", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "holding_stock", shares: "1.96", cost_basis: "500" }));
    getPrice.mockResolvedValue({ price: 510 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    getYahooOptions.mockResolvedValue(
      realChainFixture(undefined, {
        strike: 530, lastPrice: 4, bid: 3.8, ask: 4.2, volume: 300, openInterest: 400,
        impliedVolatility: 0.2, inTheMoney: false,
      })
    );

    const result = await runOptionsForUser(USER);
    const opened = result.outcomes.find((o) => o.status === "opened_cc");
    expect(opened).toBeTruthy();
    expect(opened?.detail).toMatchObject({ source: "real" });
    expect(store().ai_options_positions[0].strike).toBe("530.0000");
    expect(store().ai_options_positions[0].entry_premium).toBe("3.8000");
  });

  it("never attempts a real chain for a crypto underlying — always the BS model", async () => {
    store().ai_options_settings.push(
      baseSettings({ underlyings: [{ symbol: "BTC", class: "crypto" }] })
    );
    store().ai_options_wheel.push(wheelRow("BTC", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 62000 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    // Chain mock would answer if called — assert it's never even invoked for crypto.
    getYahooOptions.mockResolvedValue(
      realChainFixture({ strike: 58000, lastPrice: 300, bid: 290, ask: 310, volume: 100, openInterest: 200, impliedVolatility: 0.6, inTheMoney: false })
    );

    await runOptionsForUser(USER);
    expect(getYahooOptions).not.toHaveBeenCalled();
  });
});

describe("runOptionsForUser — long-play collateral tracking (lever 6)", () => {
  it("whole-contracts mode: a long-play position records real premium as collateral_usd, not 0 — so it now counts against openCapital/availableCash on the next run", async () => {
    store().ai_options_settings.push(
      baseSettings({
        whole_contracts: true,
        long_play_enabled: true,
        long_play_budget_usd: "200",
        underlyings: [{ symbol: "SOFI", class: "equity" }],
      })
    );
    store().ai_options_wheel.push(wheelRow("SOFI", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 10 });
    runCouncil.mockResolvedValue(verdict("BUY", 90));

    const result = await runOptionsForUser(USER);
    expect(result.outcomes.find((o) => o.status === "opened_long")).toBeTruthy();
    const longPos = store().ai_options_positions.find((p) => p.strategy === "long_call" || p.strategy === "long_put");
    expect(longPos).toBeTruthy();
    expect(parseFloat(longPos!.collateral_usd as string)).toBeGreaterThan(0);
  });

  it("fractional mode: unchanged, collateral_usd stays 0 — availableCash never gates anything there anyway", async () => {
    store().ai_options_settings.push(
      baseSettings({
        whole_contracts: false,
        long_play_enabled: true,
        underlyings: [{ symbol: "SOFI", class: "equity" }],
      })
    );
    store().ai_options_wheel.push(wheelRow("SOFI", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 10 });
    runCouncil.mockResolvedValue(verdict("BUY", 90));

    const result = await runOptionsForUser(USER);
    expect(result.outcomes.find((o) => o.status === "opened_long")).toBeTruthy();
    const longPos = store().ai_options_positions.find((p) => p.strategy === "long_call" || p.strategy === "long_put");
    expect(longPos?.collateral_usd).toBe("0");
  });
});

describe("runOptionsForUser — expiry settlement state transitions", () => {
  it("an assigned CSP flips the wheel to holding_stock with cost_basis = strike", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_positions.push(
      positionRow({
        strategy: "csp",
        strike: "500",
        entry_premium: "5",
        expiry: new Date(Date.now() - 86_400_000), // already expired
        status: "open",
      })
    );
    getPrice.mockResolvedValue({ price: 480 }); // spot < strike → assigned

    await runOptionsForUser(USER);

    const wheel = store().ai_options_wheel.find((w) => w.underlying === "SPY");
    expect(wheel?.state).toBe("holding_stock");
    expect(wheel?.cost_basis).toBe("500");
    const pos = store().ai_options_positions[0];
    expect(pos.status).toBe("assigned");
  });

  it("a called-away CC resets the wheel to cash", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "holding_stock", shares: "1.96", cost_basis: "500" }));
    store().ai_options_positions.push(
      positionRow({
        strategy: "cc",
        strike: "520",
        entry_premium: "3",
        opt_type: "C",
        expiry: new Date(Date.now() - 86_400_000),
        status: "open",
      })
    );
    getPrice.mockResolvedValue({ price: 540 }); // spot > strike → called away

    await runOptionsForUser(USER);

    const wheel = store().ai_options_wheel.find((w) => w.underlying === "SPY");
    expect(wheel?.state).toBe("cash");
    expect(wheel?.shares).toBe("0");
    expect(wheel?.cost_basis).toBeNull();
  });

  it("an expired pmcc_leaps position resets the wheel to pmcc_cash and clears LEAPS fields", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(
      wheelRow("SOFI", {
        state: "pmcc_holding_leaps",
        leaps_strike: "8",
        leaps_expiry: new Date(Date.now() + 200 * 86_400_000),
        leaps_net_debit: "2.5",
        leaps_units: "100",
        leaps_contract_symbol: "SOFI-C8",
      })
    );
    store().ai_options_positions.push(
      positionRow({
        underlying: "SOFI",
        strategy: "pmcc_leaps",
        strike: "8",
        entry_premium: "2.5",
        opt_type: "C",
        contract_multiplier: "100",
        expiry: new Date(Date.now() - 86_400_000),
        status: "open",
      })
    );
    getPrice.mockResolvedValue({ price: 11 });

    await runOptionsForUser(USER);

    const wheel = store().ai_options_wheel.find((w) => w.underlying === "SOFI");
    expect(wheel?.state).toBe("pmcc_cash");
    expect(wheel?.leaps_strike).toBeNull();
    expect(wheel?.leaps_contract_symbol).toBeNull();
  });
});

describe("manageOptionsPositionsForUser — daily position management", () => {
  it("kill_switch or no settings → no-op", async () => {
    store().ai_options_settings.push(baseSettings({ kill_switch: true }));
    store().ai_options_positions.push(positionRow());
    const out = await manageOptionsPositionsForUser(USER);
    expect(out).toEqual([]);
  });

  it("profit-take closes a pmcc_short at profit_take_pct and immediately re-shorts against the LEAPS", async () => {
    store().ai_options_settings.push(baseSettings({ profit_take_pct: 60 }));
    // LEAPS floor (leapsStrike+netDebit=7) sits BELOW spot(9), so the reshort's
    // strike is driven by the normal Δ-target, not the floor invariant — a
    // healthy, easily-priced premium instead of the razor-thin credit a
    // floor-forced deep-OTM strike would give (see selectPmccShort/strategy.ts).
    store().ai_options_wheel.push(
      wheelRow("SOFI", {
        state: "pmcc_holding_leaps",
        leaps_strike: "6",
        leaps_expiry: new Date(Date.now() + 200 * 86_400_000),
        leaps_net_debit: "1",
        leaps_units: "100",
        leaps_contract_symbol: "SOFI-C6",
      })
    );
    store().ai_options_positions.push(
      positionRow({
        underlying: "SOFI",
        asset_class: "equity",
        strategy: "pmcc_short",
        strike: "20", // far OTM at spot 9 — guaranteed cheap to buy back regardless of vol
        opt_type: "C",
        entry_premium: "1.00",
        expiry: new Date(Date.now() + 20 * 86_400_000),
        contract_multiplier: "100",
        status: "open",
      })
    );
    getPrice.mockResolvedValue({ price: 9 });
    getPriceHistory.mockResolvedValue(null); // fallback vol — fine now the floor isn't binding

    const out = await manageOptionsPositionsForUser(USER);
    const closed = out.find((o) => o.action === "profit_take");
    expect(closed).toBeTruthy();
    const reshort = out.find((o) => o.action === "reshort");
    expect(reshort).toBeTruthy();

    const positions = store().ai_options_positions;
    expect(positions.find((p) => p.status === "closed")?.exit_reason).toBe("profit_take");
    expect(positions.filter((p) => p.status === "open" && p.strategy === "pmcc_short")).toHaveLength(1);
  });

  it("rolls a short call once spot trades through the strike (tested)", async () => {
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "holding_stock", shares: "1", cost_basis: "500" }));
    store().ai_options_positions.push(
      positionRow({
        strategy: "cc",
        strike: "500",
        opt_type: "C",
        entry_premium: "5",
        expiry: new Date(Date.now() + 15 * 86_400_000),
        contract_multiplier: "1",
        status: "open",
      })
    );
    getPrice.mockResolvedValue({ price: 550 }); // deep through the strike → tested
    getPriceHistory.mockResolvedValue(null);

    const out = await manageOptionsPositionsForUser(USER);
    expect(out.find((o) => o.action === "roll" && o.detail?.tested === true)).toBeTruthy();
    expect(store().ai_options_positions[0].status).toBe("closed");
  });

  it("rolls a short call early once delta breaches the defensive threshold, before spot crosses the strike", async () => {
    store().ai_options_settings.push(baseSettings({ defensive_roll_delta: 40 }));
    store().ai_options_wheel.push(wheelRow("SPY", { state: "holding_stock", shares: "1", cost_basis: "500" }));
    store().ai_options_positions.push(
      positionRow({
        strategy: "cc",
        strike: "500",
        opt_type: "C",
        entry_premium: "5",
        expiry: new Date(Date.now() + 60 * 86_400_000), // far from roll_dte(21) — only delta should trigger this
        contract_multiplier: "1",
        status: "open",
      })
    );
    getPrice.mockResolvedValue({ price: 495 }); // still OTM — not tested
    getPriceHistory.mockResolvedValue(Array.from({ length: 30 }, (_, i) => 495 * (1 + 0.03 * (i % 2 === 0 ? 1 : -1)))); // real vol, pushes delta > 0.40

    const out = await manageOptionsPositionsForUser(USER);
    const rolled = out.find((o) => o.action === "roll");
    expect(rolled).toBeTruthy();
    expect(rolled?.detail?.tested).toBe(false);
    expect(rolled?.detail?.deltaBreach).toBe(true);
    expect(store().ai_options_positions[0].status).toBe("closed");
  });

  it("does not roll early when delta stays below the defensive threshold and spot/DTE conditions aren't met", async () => {
    store().ai_options_settings.push(baseSettings({ defensive_roll_delta: 40 }));
    store().ai_options_wheel.push(wheelRow("SPY", { state: "holding_stock", shares: "1", cost_basis: "500" }));
    store().ai_options_positions.push(
      positionRow({
        strategy: "cc",
        strike: "500",
        opt_type: "C",
        entry_premium: "5",
        expiry: new Date(Date.now() + 60 * 86_400_000),
        contract_multiplier: "1",
        status: "open",
      })
    );
    getPrice.mockResolvedValue({ price: 400 }); // deep OTM — low delta
    getPriceHistory.mockResolvedValue(Array.from({ length: 30 }, () => 400)); // near-zero vol

    const out = await manageOptionsPositionsForUser(USER);
    expect(out.find((o) => o.action === "roll")).toBeFalsy();
  });

  it("early-assignment heuristic fires at realistic SPY-scale strikes/DTE (regression: was unreachable above ~$50 strike with the old flat $0.05 threshold)", async () => {
    vi.setSystemTime(new Date("2026-06-15T00:00:00Z")); // June = dividend month
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "holding_stock", shares: "1", cost_basis: "400" }));
    store().ai_options_positions.push(
      positionRow({
        strategy: "cc",
        strike: "500",
        opt_type: "C",
        entry_premium: "5",
        expiry: new Date(Date.now() + 10 * 86_400_000),
        contract_multiplier: "1",
        status: "open",
      })
    );
    getPrice.mockResolvedValue({ price: 560 });
    getPriceHistory.mockResolvedValue(Array.from({ length: 30 }, (_, i) => 560 + i * 0.0001)); // near-zero vol

    const out = await manageOptionsPositionsForUser(USER);
    expect(out.find((o) => o.action === "assigned_early")).toBeTruthy();
    vi.useRealTimers();
  });

  it("early-assignment heuristic still requires extrinsic below the (now spot-scaled) floor — a large extrinsic doesn't trigger it", async () => {
    vi.setSystemTime(new Date("2026-06-15T00:00:00Z"));
    store().ai_options_settings.push(baseSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "holding_stock", shares: "1", cost_basis: "400" }));
    store().ai_options_positions.push(
      positionRow({
        strategy: "cc",
        strike: "500",
        opt_type: "C",
        entry_premium: "5",
        expiry: new Date(Date.now() + 30 * 86_400_000), // far out — real time value, not near-zero
        contract_multiplier: "1",
        status: "open",
      })
    );
    getPrice.mockResolvedValue({ price: 560 });
    getPriceHistory.mockResolvedValue(Array.from({ length: 30 }, (_, i) => 560 * (1 + 0.03 * (i % 2 === 0 ? 1 : -1)))); // real vol

    const out = await manageOptionsPositionsForUser(USER);
    expect(out.find((o) => o.action === "assigned_early")).toBeFalsy();
    vi.useRealTimers();
  });

  it("does not treat a CSP (put) as early-assignment-eligible even deep ITM in a dividend month", async () => {
    vi.setSystemTime(new Date("2026-06-15T00:00:00Z"));
    store().ai_options_settings.push(baseSettings());
    store().ai_options_positions.push(
      positionRow({
        strategy: "csp",
        strike: "500",
        opt_type: "P",
        entry_premium: "5",
        expiry: new Date(Date.now() + 10 * 86_400_000),
        contract_multiplier: "1",
        status: "open",
      })
    );
    getPrice.mockResolvedValue({ price: 440 }); // deep ITM put
    getPriceHistory.mockResolvedValue(Array.from({ length: 30 }, () => 440));

    const out = await manageOptionsPositionsForUser(USER);
    expect(out.find((o) => o.action === "assigned_early")).toBeFalsy();
    vi.useRealTimers();
  });

  it("cover-uncovered-LEAPS: sells a fresh short against a LEAPS with no live short call", async () => {
    store().ai_options_settings.push(baseSettings());
    // leapsStrike=9 vs spot=11 (~18% ITM, Δ≈0.8-ish) — deliberately NOT deep
    // enough to trip the LEAPS lifecycle loop's deep-ITM-harvest auto-close
    // (delta≥0.95) that runs before the cover-sweep; a too-deep-ITM strike
    // here closes the whole diagonal instead of leaving it uncovered.
    store().ai_options_wheel.push(
      wheelRow("SOFI", {
        state: "pmcc_holding_leaps",
        leaps_strike: "9",
        leaps_expiry: new Date(Date.now() + 200 * 86_400_000),
        leaps_net_debit: "1",
        leaps_units: "100",
        leaps_contract_symbol: "SOFI-C9",
      })
    );
    store().ai_options_positions.push(
      positionRow({
        underlying: "SOFI",
        asset_class: "equity",
        strategy: "pmcc_leaps",
        strike: "9",
        opt_type: "C",
        entry_premium: "1",
        contract_multiplier: "100",
        expiry: new Date(Date.now() + 200 * 86_400_000),
        status: "open",
      })
    );
    // No open pmcc_short exists for SOFI — the sweep should cover it. LEAPS
    // floor (10) sits below spot (11) so the fresh short is Δ-target-driven,
    // not floor-forced — a normal, easily-priced premium (see profit-take test).
    getPrice.mockResolvedValue({ price: 11 });
    getPriceHistory.mockResolvedValue(null);

    const out = await manageOptionsPositionsForUser(USER);
    expect(out.find((o) => o.action === "reshort" && o.detail?.via === "cover")).toBeTruthy();
    expect(
      store().ai_options_positions.find((p) => p.strategy === "pmcc_short" && p.status === "open")
    ).toBeTruthy();
  });
});

// ── Crypto (Deribit) wheel ───────────────────────────────────────────────────
// Two bugs kept crypto permanently inert regardless of settings: a blanket
// GUARDRAIL 1.5 skip of ALL crypto in whole-contracts mode, and a hardcoded
// 100-unit contract multiplier. Deribit BTC/ETH options are ONE COIN per
// contract, so the multiplier made an ETH put at K1700 read as $170,000 of
// collateral instead of $1,700 — it would have failed affordability even with
// the guardrail lifted.
const DERIBIT_EXP = new Date(Date.now() + 20 * 86_400_000);
function deribitQuote(strike: number, bid: number) {
  return {
    strike,
    expiry: DERIBIT_EXP,
    dte: 20,
    bid,
    ask: bid * 1.1,
    premium: bid,
    greeks: { delta: -0.22, gamma: 0, theta: 0, vega: 0, iv: 0.5 },
    openInterest: 500,
    spreadPct: 0.08,
    iv: 0.5,
    contractSymbol: `ETH-14AUG26-${strike}-P`,
  };
}

describe("runOptionsForUser — crypto via Deribit", () => {
  it("sizes an ETH CSP at ONE coin per contract, not 100", async () => {
    store().ai_options_settings.push(
      baseSettings({
        whole_contracts: true,
        underlyings: [{ symbol: "ETH", class: "crypto", mode: "wheel" }],
      })
    );
    store().ai_options_wheel.push(wheelRow("ETH", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 1854 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    fetchDeribitCSPQuote.mockResolvedValue(deribitQuote(1700, 26.95));

    const result = await runOptionsForUser(USER);
    const opened = result.outcomes.find((o) => o.status === "opened_csp");
    expect(opened).toBeTruthy();
    const pos = store().ai_options_positions[0];
    // 1700 × 1, NOT 1700 × 100 — this is the whole point of the fix.
    expect(pos.collateral_usd).toBe("1700.00");
    expect(pos.contract_multiplier).toBe("1.00000000");
    expect(pos.entry_premium).toBe("26.9500");
  });

  it("still rejects BTC — one contract's collateral dwarfs the account", async () => {
    store().ai_options_settings.push(
      baseSettings({
        whole_contracts: true,
        underlyings: [{ symbol: "BTC", class: "crypto", mode: "wheel" }],
      })
    );
    store().ai_options_wheel.push(wheelRow("BTC", { state: "cash" }));
    getPrice.mockResolvedValue({ price: 64_139 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    // $58k of collateral against a $10k account.
    fetchDeribitCSPQuote.mockResolvedValue(deribitQuote(58_000, 416.91));

    const result = await runOptionsForUser(USER);
    expect(result.outcomes.find((o) => o.status === "opened_csp")).toBeUndefined();
    expect(store().ai_options_positions).toHaveLength(0);
  });

  it("still skips a crypto PMCC diagonal (GUARDRAIL 1.5 narrowed, not removed)", async () => {
    store().ai_options_settings.push(
      baseSettings({
        whole_contracts: true,
        underlyings: [{ symbol: "BTC", class: "crypto", mode: "pmcc" }],
      })
    );
    getPrice.mockResolvedValue({ price: 64_139 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));

    const result = await runOptionsForUser(USER);
    expect(result.outcomes[0]).toMatchObject({ status: "skipped" });
    expect(String(result.outcomes[0].reason)).toMatch(/PMCC diagonal not affordable/);
    expect(store().ai_options_positions).toHaveLength(0);
  });

  it("an ITM crypto put at expiry books the cash loss and returns the slot to cash", async () => {
    // Cash-settled: no coins arrive, so holding_stock would strand the slot
    // forever (it would wait to write calls against a position that doesn't exist).
    store().ai_options_settings.push(
      baseSettings({
        whole_contracts: true,
        underlyings: [{ symbol: "ETH", class: "crypto", mode: "wheel" }],
      })
    );
    store().ai_options_wheel.push(wheelRow("ETH", { state: "cash" }));
    store().ai_options_positions.push(
      positionRow({
        underlying: "ETH",
        asset_class: "crypto",
        strategy: "csp",
        strike: "1700",
        entry_premium: "27",
        contract_multiplier: "1",
        expiry: new Date(Date.now() - 86_400_000), // expired
        collateral_usd: "1700",
      })
    );
    getPrice.mockResolvedValue({ price: 1600 }); // ITM by $100
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    fetchDeribitCSPQuote.mockResolvedValue(null);

    await runOptionsForUser(USER);
    const settled = store().ai_options_positions.find((p) => p.status === "assigned");
    expect(settled).toBeTruthy();
    // premium 27 − intrinsic 100 − $0.65 commission = −73.65, realized NOW
    // rather than deferred into an assigned position's cost basis.
    expect(parseFloat(String(settled!.realized_pnl))).toBeCloseTo(-73.65, 2);
    const wheel = store().ai_options_wheel.find((w) => w.underlying === "ETH");
    expect(wheel!.state).toBe("cash");
    expect(wheel!.shares).toBe("0");
  });

  it("never writes a covered call against crypto", async () => {
    // Defensive: a legacy holding_stock row must not sell calls on coins we
    // never received.
    store().ai_options_settings.push(
      baseSettings({
        whole_contracts: true,
        underlyings: [{ symbol: "ETH", class: "crypto", mode: "wheel" }],
      })
    );
    store().ai_options_wheel.push(
      wheelRow("ETH", { state: "holding_stock", shares: "1", cost_basis: "1700" })
    );
    getPrice.mockResolvedValue({ price: 1854 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));

    const result = await runOptionsForUser(USER);
    expect(String(result.outcomes[0].reason)).toMatch(/cash-settled/);
    expect(store().ai_options_positions).toHaveLength(0);
  });
});

// ── Screener multi-buy ───────────────────────────────────────────────────────
// The screener used to buy exactly ONE diagonal and `continue`. Combined with
// the weekly idempotency claim on the single triggering slot, that capped the
// account at one new diagonal per ISO week — a $10k book carrying ~$500
// diagonals could never deploy its cash.
const screenerMod = await import("@/lib/options/screener");
const mockScreen = vi.mocked(screenerMod.screenPmccCandidates);

function screened(symbol: string, debit: number, yieldPct: number) {
  return {
    symbol,
    spot: 20,
    leapsStrike: 14,
    leapsExpiry: new Date(Date.now() + 300 * 86_400_000),
    leapsDte: 300,
    leapsAsk: debit / 100,
    leapsDebitUsd: debit,
    leapsDelta: 0.8,
    leapsIV: 0.4,
    leapsOI: 500,
    leapsSpreadPct: 0.05,
    shortStrike: 22,
    shortExpiry: new Date(Date.now() + 35 * 86_400_000),
    shortDte: 35,
    shortMid: 0.5,
    shortOI: 400,
    annualizedYieldPct: yieldPct,
    affordable: true,
    reasons: [] as string[],
  };
}

function pmccSlotSettings() {
  return baseSettings({
    whole_contracts: true,
    auto_select_underlying: true,
    pmcc_watchlist: ["A", "B", "C", "D"],
    underlyings: [{ symbol: "SPY", class: "etf", mode: "pmcc" }],
  });
}

describe("runOptionsForUser — screener multi-buy", () => {
  it("opens up to the per-run cap (3) in a single run instead of just one", async () => {
    store().ai_options_settings.push(pmccSlotSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "pmcc_cash" }));
    getPrice.mockResolvedValue({ price: 500 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    mockScreen.mockResolvedValue({
      ranked: [
        screened("A", 500, 150),
        screened("B", 600, 140),
        screened("C", 700, 130),
        screened("D", 800, 120),
      ],
      rejected: [],
      errors: {},
    });

    const result = await runOptionsForUser(USER);
    const opened = result.outcomes.filter((o) => o.status === "opened_long");
    expect(opened).toHaveLength(3); // cap, not 1 and not all 4
    expect(opened.map((o) => o.underlying)).toEqual(["A", "B", "C"]); // best yield first
    expect(store().ai_options_positions).toHaveLength(3);
    // Each buy gets its own wheel row in holding_leaps.
    for (const s of ["A", "B", "C"]) {
      expect(store().ai_options_wheel.find((w) => w.underlying === s)!.state).toBe(
        "pmcc_holding_leaps"
      );
    }
  });

  it("stops early when remaining cash can't fund the next candidate", async () => {
    store().ai_options_settings.push(
      pmccSlotSettings()
    );
    store().ai_options_wheel.push(wheelRow("SPY", { state: "pmcc_cash" }));
    // $9,000 already committed → only $1,000 of the $10k account is free.
    store().ai_options_positions.push(
      positionRow({ underlying: "ZZ", strategy: "pmcc_leaps", side: "long", collateral_usd: "9000", expiry: new Date(Date.now() + 300 * 86_400_000) })
    );
    getPrice.mockResolvedValue({ price: 500 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    mockScreen.mockResolvedValue({
      ranked: [screened("A", 600, 150), screened("B", 600, 140), screened("C", 600, 130)],
      rejected: [],
      errors: {},
    });

    const result = await runOptionsForUser(USER);
    const opened = result.outcomes.filter((o) => o.status === "opened_long");
    // $1,000 free funds exactly one $600 diagonal; the second would overdraw.
    expect(opened).toHaveLength(1);
    expect(opened[0].underlying).toBe("A");
  });

  it("never buys the same symbol twice in one run", async () => {
    store().ai_options_settings.push(pmccSlotSettings());
    store().ai_options_wheel.push(wheelRow("SPY", { state: "pmcc_cash" }));
    getPrice.mockResolvedValue({ price: 500 });
    runCouncil.mockResolvedValue(verdict("HOLD", 50));
    // Only ONE distinct candidate — the loop must not re-buy it on each pass.
    mockScreen.mockResolvedValue({
      ranked: [screened("A", 500, 150)],
      rejected: [],
      errors: {},
    });

    const result = await runOptionsForUser(USER);
    expect(result.outcomes.filter((o) => o.status === "opened_long")).toHaveLength(1);
    expect(store().ai_options_positions).toHaveLength(1);
  });
});
