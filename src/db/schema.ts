import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  jsonb,
  uuid,
  primaryKey,
  boolean,
  date,
  index,
  unique,
  uniqueIndex,
  foreignKey,
  bigserial,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerk_id: text("clerk_id").unique().notNull(),
  email: text("email"),
  base_currency: text("base_currency").default("USD").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  currency: text("currency").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const assets = pgTable("assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  account_id: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  ticker: text("ticker"),
  name: text("name"),
  qty: numeric("qty", { precision: 24, scale: 8 }),
  cost_basis: numeric("cost_basis", { precision: 18, scale: 2 }),
  currency: text("currency").notNull(),
  asset_class: text("asset_class").notNull(),
  current_value: numeric("current_value", { precision: 18, scale: 2 }),
  last_priced_at: timestamp("last_priced_at"),
  auto_price: boolean("auto_price").default(true).notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const liabilities = pgTable("liabilities", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  balance: numeric("balance", { precision: 18, scale: 2 }).notNull(),
  interest_rate: numeric("interest_rate", { precision: 6, scale: 4 }),
  monthly_payment: numeric("monthly_payment", { precision: 18, scale: 2 }),
  currency: text("currency").notNull(),
  linked_asset_id: uuid("linked_asset_id"),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  cycle: text("cycle").notNull(),
  next_charge: timestamp("next_charge"),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const fixed_expenses = pgTable("fixed_expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  cycle: text("cycle").notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const insurance_policies = pgTable("insurance_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  cycle: text("cycle").notNull(),
  for_who: text("for_who").notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const income_sources = pgTable("income_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  cycle: text("cycle").notNull(),
  type: text("type").notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const investment_commitments = pgTable("investment_commitments", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  target_amount: numeric("target_amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  cycle: text("cycle").notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  account_id: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  category: text("category"),
  ts: timestamp("ts").defaultNow().notNull(),
});

export const fx_rates_cache = pgTable(
  "fx_rates_cache",
  {
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    fetched_at: timestamp("fetched_at").defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.base, t.quote] }) })
);

export const market_data_cache = pgTable("market_data_cache", {
  ticker: text("ticker").primaryKey(),
  payload: jsonb("payload").notNull(),
  fetched_at: timestamp("fetched_at").defaultNow().notNull(),
});

export const council_verdict_cache = pgTable("council_verdict_cache", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  asset_class: text("asset_class").notNull(),
  verdict: text("verdict").notNull(),
  confidence: integer("confidence"),
  payload: jsonb("payload").notNull(),
  fetched_at: timestamp("fetched_at").defaultNow().notNull(),
});

// ─── Crypto Scanner History ──────────────────────────────────────────────────

export const scanner_history = pgTable(
  "scanner_history",
  {
    scanned_date: date("scanned_date").notNull(),
    coin_id: text("coin_id").notNull(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    score_moonshot: integer("score_moonshot").notNull(),
    score_scalp: integer("score_scalp").notNull(),
    rank_moonshot: integer("rank_moonshot").notNull(),
    rank_scalp: integer("rank_scalp").notNull(),
    price: numeric("price", { precision: 18, scale: 8 }).notNull(),
    mcap: numeric("mcap", { precision: 18, scale: 2 }).notNull(),
    dims: jsonb("dims").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.scanned_date, t.coin_id] }),
    symbol_idx: index("scanner_history_symbol_idx").on(t.symbol),
    date_idx: index("scanner_history_date_idx").on(t.scanned_date),
  })
);

// ─── Scanner Watchlist ────────────────────────────────────────────────────────

export const scanner_watchlist = pgTable(
  "scanner_watchlist",
  {
    user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    coin_id: text("coin_id").notNull(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    added_at: timestamp("added_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.user_id, t.coin_id] }),
    user_idx: index("scanner_watchlist_user_idx").on(t.user_id),
  })
);

// ─── Daily P/L snapshot (30-day calendar) ────────────────────────────────────

// Durable per-(user, day, bot) realized-P/L + activity, one row per bot per day.
// Absence of a row for a (day, bot) means "no data / no activity" — the calendar
// renders those days as the highlighted no-activity state. realized_pnl null =
// bot has no realized-P/L concept (crypto DCA). See drizzle/0010_daily_pnl.sql.
export const daily_pnl = pgTable(
  "daily_pnl",
  {
    user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    day: date("day").notNull(),
    bot: text("bot").notNull(), // crypto|options|quant|gold|pdhl
    realized_pnl: numeric("realized_pnl", { precision: 18, scale: 2 }),
    return_pct: numeric("return_pct", { precision: 10, scale: 4 }),
    activity_count: integer("activity_count").default(0).notNull(),
    equity: numeric("equity", { precision: 18, scale: 2 }),
    source: text("source").default("snapshot").notNull(), // 'snapshot' | 'backfill'
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.user_id, t.day, t.bot] }),
    user_day_idx: index("daily_pnl_user_day_idx").on(t.user_id, t.day),
  })
);

// ─── Immutable strategy performance ledger ──────────────────────────────────

// daily_pnl above remains a mutable compatibility projection for the calendar.
// These tables are the authoritative forward-evidence store. Rows are immutable
// at the database layer (see drizzle/0011_strategy_ledger.sql).
export const strategy_runs = pgTable(
  "strategy_runs",
  {
    id: uuid("id").primaryKey(),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    strategy_key: text("strategy_key").notNull(),
    implementation_version: text("implementation_version").notNull(),
    parameter_version: text("parameter_version").notNull(),
    parameter_hash: text("parameter_hash").notNull(),
    mode: text("mode").notNull(), // paper | live
    lifecycle: text("lifecycle").notNull(), // live | paper | benched | retired
    evidence_class: text("evidence_class").notNull(), // forward | historical_research | legacy_incomplete
    inception_at: timestamp("inception_at").notNull(),
    ended_at: timestamp("ended_at"),
    source: text("source").notNull(),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    identity_unique: unique("strategy_runs_identity_unique").on(t.id, t.user_id, t.strategy_key),
    user_strategy_idx: index("strategy_runs_user_strategy_idx").on(t.user_id, t.strategy_key),
  }),
);

export const strategy_events = pgTable(
  "strategy_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    run_id: uuid("run_id").notNull(),
    strategy_key: text("strategy_key").notNull(),
    event_type: text("event_type").notNull(), // order_intent | execution | fill | trade | cash_flow | run_end
    idempotency_key: text("idempotency_key").unique().notNull(),
    event_at: timestamp("event_at").notNull(),
    parent_trade_id: text("parent_trade_id"),
    pair_id: text("pair_id"),
    leg_id: text("leg_id"),
    symbol: text("symbol"),
    side: text("side"),
    quantity: numeric("quantity", { precision: 24, scale: 8 }),
    price: numeric("price", { precision: 24, scale: 8 }),
    gross_amount: numeric("gross_amount", { precision: 20, scale: 6 }),
    fees: numeric("fees", { precision: 20, scale: 6 }).default("0").notNull(),
    spread_cost: numeric("spread_cost", { precision: 20, scale: 6 }).default("0").notNull(),
    slippage_cost: numeric("slippage_cost", { precision: 20, scale: 6 }).default("0").notNull(),
    financing_funding: numeric("financing_funding", { precision: 20, scale: 6 }).default("0").notNull(),
    currency: text("currency").default("USD").notNull(),
    quote_source: text("quote_source"),
    quote_at: timestamp("quote_at"),
    price_provenance: text("price_provenance").notNull(), // executable | modeled | journaled
    broker_reference: text("broker_reference"),
    source: text("source").notNull(),
    evidence_class: text("evidence_class").notNull(),
    detail: jsonb("detail"),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    run_identity_fk: foreignKey({
      name: "strategy_events_run_identity_fk",
      columns: [t.run_id, t.user_id, t.strategy_key],
      foreignColumns: [strategy_runs.id, strategy_runs.user_id, strategy_runs.strategy_key],
    }).onDelete("cascade"),
    run_event_idx: index("strategy_events_run_event_idx").on(t.run_id, t.event_at),
    parent_trade_idx: index("strategy_events_parent_trade_idx").on(t.parent_trade_id),
    pair_idx: index("strategy_events_pair_idx").on(t.pair_id),
  }),
);

export const strategy_daily_observations = pgTable(
  "strategy_daily_observations",
  {
    user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    strategy_key: text("strategy_key").notNull(),
    run_id: uuid("run_id").notNull(),
    day: date("day").notNull(),
    opening_marked_nlv: numeric("opening_marked_nlv", { precision: 20, scale: 6 }).notNull(),
    closing_marked_nlv: numeric("closing_marked_nlv", { precision: 20, scale: 6 }).notNull(),
    gross_realized_pnl: numeric("gross_realized_pnl", { precision: 20, scale: 6 }).notNull(),
    net_realized_pnl: numeric("net_realized_pnl", { precision: 20, scale: 6 }).notNull(),
    unrealized_pnl: numeric("unrealized_pnl", { precision: 20, scale: 6 }).notNull(),
    gross_return: numeric("gross_return", { precision: 14, scale: 8 }),
    net_return: numeric("net_return", { precision: 14, scale: 8 }),
    fees: numeric("fees", { precision: 20, scale: 6 }).default("0").notNull(),
    spread_cost: numeric("spread_cost", { precision: 20, scale: 6 }).default("0").notNull(),
    slippage_cost: numeric("slippage_cost", { precision: 20, scale: 6 }).default("0").notNull(),
    financing_funding: numeric("financing_funding", { precision: 20, scale: 6 }).default("0").notNull(),
    cash_flows: numeric("cash_flows", { precision: 20, scale: 6 }).default("0").notNull(),
    deposits: numeric("deposits", { precision: 20, scale: 6 }).default("0").notNull(),
    withdrawals: numeric("withdrawals", { precision: 20, scale: 6 }).default("0").notNull(),
    gross_exposure: numeric("gross_exposure", { precision: 20, scale: 6 }).default("0").notNull(),
    net_exposure: numeric("net_exposure", { precision: 20, scale: 6 }).default("0").notNull(),
    drawdown: numeric("drawdown", { precision: 14, scale: 8 }),
    benchmark_return: numeric("benchmark_return", { precision: 14, scale: 8 }),
    volatility_matched_benchmark_return: numeric("volatility_matched_benchmark_return", { precision: 14, scale: 8 }),
    reconciliation_status: text("reconciliation_status").notNull(),
    reconciliation_difference: numeric("reconciliation_difference", { precision: 20, scale: 6 }),
    reconciliation_difference_pct: numeric("reconciliation_difference_pct", { precision: 14, scale: 8 }),
    activity_count: integer("activity_count").default(0).notNull(),
    source: text("source").notNull(),
    evidence_class: text("evidence_class").notNull(),
    observed_at: timestamp("observed_at").notNull(),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.user_id, t.strategy_key, t.run_id, t.day] }),
    run_identity_fk: foreignKey({
      name: "strategy_daily_observations_run_identity_fk",
      columns: [t.run_id, t.user_id, t.strategy_key],
      foreignColumns: [strategy_runs.id, strategy_runs.user_id, strategy_runs.strategy_key],
    }).onDelete("cascade"),
    user_day_idx: index("strategy_daily_observations_user_day_idx").on(t.user_id, t.day),
  }),
);

export const strategy_reconciliation_snapshots = pgTable(
  "strategy_reconciliation_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    run_id: uuid("run_id").notNull(),
    strategy_key: text("strategy_key").notNull(),
    idempotency_key: text("idempotency_key").unique().notNull(),
    broker: text("broker").notNull(),
    environment: text("environment").notNull(),
    account_fingerprint: text("account_fingerprint").notNull(),
    status: text("status").notNull(), // reconciled | unreconciled | stale | degraded
    difference: numeric("difference", { precision: 20, scale: 6 }),
    difference_pct: numeric("difference_pct", { precision: 14, scale: 8 }),
    positions: jsonb("positions").notNull(),
    open_orders: jsonb("open_orders").notNull(),
    mismatches: jsonb("mismatches").notNull(),
    source: text("source").notNull(),
    snapshot_at: timestamp("snapshot_at").notNull(),
    valid_until: timestamp("valid_until").notNull(),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    run_identity_fk: foreignKey({
      name: "strategy_reconciliation_run_identity_fk",
      columns: [t.run_id, t.user_id, t.strategy_key],
      foreignColumns: [strategy_runs.id, strategy_runs.user_id, strategy_runs.strategy_key],
    }).onDelete("cascade"),
    run_snapshot_idx: index("strategy_reconciliation_run_snapshot_idx").on(t.run_id, t.snapshot_at),
  }),
);

// ─── AI Portfolio: automated trading ─────────────────────────────────────────

// One row per user. kill_switch defaults TRUE = HALTED until user explicitly arms.
export const ai_trading_settings = pgTable("ai_trading_settings", {
  user_id: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .primaryKey(),
  kill_switch: boolean("kill_switch").default(true).notNull(),
  monthly_cap_usd: numeric("monthly_cap_usd", { precision: 18, scale: 2 }).default("1300").notNull(),
  dca_amount_usd: numeric("dca_amount_usd", { precision: 18, scale: 2 }).default("150").notNull(),
  boost_amount_usd: numeric("boost_amount_usd", { precision: 18, scale: 2 }).default("250").notNull(),
  buy_zone_confidence: integer("buy_zone_confidence").default(65).notNull(),
  sell_skip_threshold: integer("sell_skip_threshold").default(70).notNull(),
  max_consecutive_skips: integer("max_consecutive_skips").default(1).notNull(),
  tokens: jsonb("tokens").default(["BTC", "ETH", "SOL", "HYPE"]).notNull(),
  // Per-token overrides: { "HYPE": { "max_price": 58 }, "BTC": { "max_price": 100000 } }
  token_overrides: jsonb("token_overrides").default({}).notNull(),
  // One-shot BTC-dip trigger: when armed and BTC < dip_trigger_price, fire an
  // unconditional dip_trigger_amount buy across all tokens once, then set
  // dip_trigger_fired and resume normal council DCA.
  dip_trigger_enabled: boolean("dip_trigger_enabled").default(false).notNull(),
  dip_trigger_price: numeric("dip_trigger_price", { precision: 18, scale: 2 }),
  dip_trigger_amount: numeric("dip_trigger_amount", { precision: 18, scale: 2 }),
  dip_trigger_fired: boolean("dip_trigger_fired").default(false).notNull(),
  last_alert: text("last_alert"),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

// Per-token next scheduled DCA run (14-day cadence driver).
export const ai_token_schedule = pgTable(
  "ai_token_schedule",
  {
    user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    token: text("token").notNull(),
    next_run_at: timestamp("next_run_at").notNull(),
    consecutive_skips: integer("consecutive_skips").default(0).notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.user_id, t.token] }) })
);

// Full audit log of every order intent + result. idempotency_key unique → no double-buy per period.
export const ai_trade_orders = pgTable("ai_trade_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  token: text("token").notNull(),
  venue: text("venue").notNull(), // "okx" | "hyperliquid"
  side: text("side").default("buy").notNull(),
  usd_amount: numeric("usd_amount", { precision: 18, scale: 2 }).notNull(),
  qty: numeric("qty", { precision: 24, scale: 8 }),
  price: numeric("price", { precision: 18, scale: 8 }),
  boosted: boolean("boosted").default(false).notNull(),
  council_verdict: text("council_verdict"),
  council_confidence: integer("council_confidence"),
  dip_depth_pct: numeric("dip_depth_pct", { precision: 8, scale: 2 }),
  status: text("status").notNull(), // "filled" | "failed" | "skipped"
  idempotency_key: text("idempotency_key").unique().notNull(),
  exchange_order_id: text("exchange_order_id"),
  error: text("error"),
  gate_trace: jsonb("gate_trace"), // GateTrace {v:1, gates:[...]} — null on pre-trace rows
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// ─── AI Portfolio: automated OPTIONS (paper trading) ─────────────────────────

// One row per user. kill_switch defaults TRUE = HALTED. paper defaults TRUE = simulated.
export const ai_options_settings = pgTable("ai_options_settings", {
  user_id: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .primaryKey(),
  kill_switch: boolean("kill_switch").default(true).notNull(),
  paper: boolean("paper").default(true).notNull(),
  entries_enabled: boolean("entries_enabled").default(false).notNull(),
  risk_reducing_management_enabled: boolean("risk_reducing_management_enabled").default(false).notNull(),
  application_mode: text("application_mode").default("paper").notNull(),
  broker_environment: text("broker_environment").default("paper").notNull(),
  broker_account_fingerprint: text("broker_account_fingerprint"),
  reconciliation_max_age_seconds: integer("reconciliation_max_age_seconds").default(300).notNull(),
  allocated_marked_nlv_limit_usd: numeric("allocated_marked_nlv_limit_usd", { precision: 18, scale: 2 }).default("6000").notNull(),
  // Legacy compatibility ceiling. New allocation decisions use marked NLV above.
  max_collateral_usd: numeric("max_collateral_usd", { precision: 18, scale: 2 }).default("6000").notNull(),
  long_play_budget_usd: numeric("long_play_budget_usd", { precision: 18, scale: 2 }).default("200").notNull(),
  long_play_enabled: boolean("long_play_enabled").default(true).notNull(),
  target_delta: integer("target_delta").default(22).notNull(), // 0.22 — ~78% POP on CSP
  dte_min: integer("dte_min").default(14).notNull(),
  dte_max: integer("dte_max").default(30).notNull(),
  conviction_threshold: integer("conviction_threshold").default(75).notNull(),
  risk_free_rate: numeric("risk_free_rate", { precision: 6, scale: 4 }).default("0.0400").notNull(),
  collateral_per_contract_usd: numeric("collateral_per_contract_usd", { precision: 18, scale: 2 }).default("500").notNull(),
  // PMCC (Poor Man's Covered Call) — applies to underlyings tagged mode:"pmcc".
  pmcc_leaps_delta: integer("pmcc_leaps_delta").default(80).notNull(), // 0.80 deep-ITM LEAPS
  pmcc_leaps_dte_min: integer("pmcc_leaps_dte_min").default(180).notNull(),
  pmcc_leaps_dte_max: integer("pmcc_leaps_dte_max").default(365).notNull(),
  pmcc_budget_usd: numeric("pmcc_budget_usd", { precision: 18, scale: 2 }).default("10000").notNull(), // max debit per LEAPS (hard ceiling; matches default account_size_usd so pmcc_budget_pct governs, not this)
  // ── Live-account realism (whole contracts, $-account sizing, fills) ────────
  account_size_usd: numeric("account_size_usd", { precision: 18, scale: 2 }).default("10000").notNull(),
  whole_contracts: boolean("whole_contracts").default(false).notNull(), // 1 contract = 100 shares, no fractional multipliers
  profit_take_pct: integer("profit_take_pct").default(60).notNull(), // close short at % of max profit
  roll_dte: integer("roll_dte").default(21).notNull(), // roll/close short at this DTE
  defensive_roll_delta: integer("defensive_roll_delta").default(40).notNull(), // 0.40 — roll short leg early once delta climbs this high, before spot fully crosses the strike (caps single-day realized-loss size on fast rallies)
  earnings_blackout_days: integer("earnings_blackout_days").default(3).notNull(), // force-roll a short leg (and skip new PMCC diagonals) once the underlying's next earnings print is this many days out
  max_positions_per_sector: integer("max_positions_per_sector").default(2).notNull(), // cap on concurrently-open PMCC diagonals sharing a GICS sector, enforced when picking new screener buys
  short_dte_min: integer("short_dte_min").default(30).notNull(), // PMCC short-leg window (separate from CSP dte)
  short_dte_max: integer("short_dte_max").default(45).notNull(),
  pmcc_budget_pct: integer("pmcc_budget_pct").default(60).notNull(), // LEAPS debit ≤ % of account
  commission_per_contract: numeric("commission_per_contract", { precision: 8, scale: 4 }).default("0.65").notNull(),
  slippage_pct: integer("slippage_pct").default(3).notNull(), // half-spread haircut, % of premium
  leaps_roll_dte: integer("leaps_roll_dte").default(100).notNull(), // roll LEAPS below this DTE
  pmcc_watchlist: jsonb("pmcc_watchlist").default(["SOFI", "F", "AAL", "PLTR", "INTC", "IWM"]).notNull(),
  auto_select_underlying: boolean("auto_select_underlying").default(false).notNull(),
  // [{ "symbol": "SPY", "class": "etf", "mode": "wheel" | "pmcc" }] — mode optional, defaults "wheel"
  underlyings: jsonb("underlyings")
    .default([
      { symbol: "SPY", class: "etf" },
      { symbol: "AAPL", class: "equity" },
      { symbol: "BTC", class: "crypto" },
    ])
    .notNull(),
  last_alert: text("last_alert"),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

// Wheel state machine per (user, underlying). cash → sell puts; holding_stock → sell calls.
export const ai_options_wheel = pgTable(
  "ai_options_wheel",
  {
    user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    underlying: text("underlying").notNull(),
    state: text("state").default("cash").notNull(), // wheel: cash|holding_stock — pmcc: pmcc_cash|pmcc_holding_leaps
    shares: numeric("shares", { precision: 24, scale: 8 }).default("0").notNull(),
    cost_basis: numeric("cost_basis", { precision: 18, scale: 4 }), // per-share when holding
    // PMCC LEAPS tracking (null on wheel underlyings).
    leaps_strike: numeric("leaps_strike", { precision: 18, scale: 4 }),
    leaps_expiry: timestamp("leaps_expiry"),
    leaps_net_debit: numeric("leaps_net_debit", { precision: 18, scale: 4 }), // per-unit premium paid → short-call floor
    leaps_units: numeric("leaps_units", { precision: 24, scale: 8 }), // LEAPS multiplier → short call covers exactly
    leaps_contract_symbol: text("leaps_contract_symbol"),
    next_run_at: timestamp("next_run_at"),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.user_id, t.underlying] }) })
);

// Every option contract opened (paper). Settled rows keep status + realized_pnl.
export const ai_options_positions = pgTable("ai_options_positions", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  underlying: text("underlying").notNull(),
  asset_class: text("asset_class").notNull(), // equity | etf | crypto
  strategy: text("strategy").notNull(), // csp | cc | long_call | long_put
  side: text("side").notNull(), // short | long
  contract_symbol: text("contract_symbol").notNull(),
  strike: numeric("strike", { precision: 18, scale: 4 }).notNull(),
  expiry: timestamp("expiry").notNull(),
  opt_type: text("opt_type").notNull(), // C | P
  contracts: integer("contracts").default(1).notNull(),
  contract_multiplier: numeric("contract_multiplier", { precision: 18, scale: 8 }).default("100").notNull(), // collateral_per_contract / strike
  entry_premium: numeric("entry_premium", { precision: 18, scale: 4 }).notNull(), // per share
  entry_spot: numeric("entry_spot", { precision: 18, scale: 4 }).notNull(),
  collateral_usd: numeric("collateral_usd", { precision: 18, scale: 2 }).default("0").notNull(),
  greeks: jsonb("greeks"),
  council_verdict: text("council_verdict"),
  council_confidence: integer("council_confidence"),
  status: text("status").default("open").notNull(), // open | expired_worthless | assigned | called_away | closed
  realized_pnl: numeric("realized_pnl", { precision: 18, scale: 2 }),
  exit_reason: text("exit_reason"), // expiry | profit_take | roll | leaps_roll | deep_itm_harvest | assigned_early
  exit_premium: numeric("exit_premium", { precision: 18, scale: 4 }), // per-unit close price for early exits
  opened_at: timestamp("opened_at").defaultNow().notNull(),
  settled_at: timestamp("settled_at"),
  // Set only for real broker fills (AlpacaBroker.placeOrder's brokerOrderId) —
  // null means this position is simulated (paper, or the model/real-chain
  // paths). account_sync reconciliation keys off this to know which DB rows
  // should have a live counterpart at the broker.
  broker_order_id: text("broker_order_id"),
});

// Audit log of every engine action. idempotency_key unique → no double-action per period.
export const ai_options_orders = pgTable("ai_options_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  underlying: text("underlying").notNull(),
  action: text("action").notNull(), // open_csp | open_cc | open_long | settle | skip
  idempotency_key: text("idempotency_key").unique().notNull(),
  detail: jsonb("detail"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// Vulcan equity screener — weekly sector-momentum + RS/volume/stage rotation.
// Written by quant-scrap/vulcan/run.py (VPS cron), read-only from Next.js.
export const vulcan_positions = pgTable(
  "vulcan_positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    symbol: text("symbol").notNull(),
    qty: numeric("qty", { precision: 20, scale: 8 }).notNull(),
    entry_price: numeric("entry_price", { precision: 18, scale: 4 }).notNull(),
    entry_date: timestamp("entry_date").notNull(),
    still_open: boolean("still_open").default(true).notNull(),
    exit_price: numeric("exit_price", { precision: 18, scale: 4 }),
    exit_date: timestamp("exit_date"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Partial unique index: at most one OPEN row per (user_id, symbol). Closed
    // (still_open=false) history rows are unaffected — a symbol can be
    // re-entered/re-exited many times over its history.
    one_open_per_symbol: uniqueIndex("vulcan_positions_open_symbol_uq")
      .on(t.user_id, t.symbol)
      .where(sql`${t.still_open} = true`),
  }),
);

export const vulcan_scores = pgTable(
  "vulcan_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    run_date: date("run_date").notNull(),
    symbol: text("symbol").notNull(),
    sector: text("sector").notNull(),
    rs_percentile: numeric("rs_percentile", { precision: 6, scale: 3 }).notNull(),
    ud_ratio: numeric("ud_ratio", { precision: 12, scale: 4 }).notNull(),
    ud_percentile: numeric("ud_percentile", { precision: 6, scale: 3 }).notNull(),
    stage2_eligible: boolean("stage2_eligible").notNull(),
    composite_score: numeric("composite_score", { precision: 6, scale: 3 }).notNull(),
    composite_rank: integer("composite_rank"), // null if not in that week's top 20
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    run_date_idx: index("vulcan_scores_run_date_idx").on(t.run_date),
  }),
);

// ─── Universe bot: intraday Kronos-gated pullback bot on 30 tech mega-caps ───
// Owned by quant-scrap/universe/universe_db.py — the bot is the only writer,
// this dashboard is read-only. Mirrors that module's raw-SQL table shape.
export const universe_positions = pgTable(
  "universe_positions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    user_id: uuid("user_id").notNull(),
    symbol: text("symbol").notNull(),
    qty: numeric("qty", { precision: 24, scale: 8 }).notNull(),
    entry_price: numeric("entry_price", { precision: 18, scale: 4 }).notNull(),
    entry_at: timestamp("entry_at", { withTimezone: true }).defaultNow().notNull(),
    oco_order_id: text("oco_order_id"),
    still_open: boolean("still_open").default(true).notNull(),
    exit_price: numeric("exit_price", { precision: 18, scale: 4 }),
    exit_at: timestamp("exit_at", { withTimezone: true }),
    exit_reason: text("exit_reason"), // target | stop | time_stop | broker_closed
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export const universe_cooldowns = pgTable(
  "universe_cooldowns",
  {
    user_id: uuid("user_id").notNull(),
    symbol: text("symbol").notNull(),
    until_at: timestamp("until_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.user_id, t.symbol] }),
  }),
);
