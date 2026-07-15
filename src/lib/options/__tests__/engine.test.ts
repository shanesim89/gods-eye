// Orchestration tests for runOptionsForUser / manageOptionsPositionsForUser —
// the part of the options bot with ZERO prior test coverage (strategy.ts's
// pure math is tested; the gate ordering, state transitions, and idempotency
// that actually decide whether/when a trade fires were not). Uses an
// in-memory fake for `db` (see ./fakeDb.ts) so real engine.ts control flow
// runs without a Postgres connection — collaborators (price feed, council,
// screener) are mocked directly since they're tested/testable elsewhere.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Store, Row } from "./fakeDb";

const hoisted = vi.hoisted(() => ({ store: null as Store | null }));

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
vi.mock("@/lib/yahoo", () => ({ getYahooOptions: (...a: unknown[]) => getYahooOptions(...a) }));

const { runOptionsForUser, manageOptionsPositionsForUser } = await import("../engine");

const USER = "11111111-1111-1111-1111-111111111111";

function verdict(v: "BUY" | "HOLD" | "SELL", confidence: number) {
  return { verdict: v, confidence, summary: "", agents: [], generatedAt: new Date().toISOString() };
}

function baseSettings(overrides: Partial<Row> = {}): Row {
  return {
    user_id: USER,
    kill_switch: false,
    paper: true,
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
  getPrice.mockReset();
  getPriceHistory.mockReset();
  runCouncil.mockReset();
  getYahooOptions.mockReset();
  // Default: no real chain available — every CSP/CC test falls back to the
  // pre-existing BS-off-HV path unless it explicitly opts into a real quote.
  getYahooOptions.mockResolvedValue(null);
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
