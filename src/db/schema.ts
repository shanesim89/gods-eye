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
} from "drizzle-orm/pg-core";

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
  max_collateral_usd: numeric("max_collateral_usd", { precision: 18, scale: 2 }).default("200000").notNull(),
  long_play_budget_usd: numeric("long_play_budget_usd", { precision: 18, scale: 2 }).default("200").notNull(),
  long_play_enabled: boolean("long_play_enabled").default(true).notNull(),
  target_delta: integer("target_delta").default(30).notNull(), // 0.30
  dte_min: integer("dte_min").default(7).notNull(),
  dte_max: integer("dte_max").default(14).notNull(),
  conviction_threshold: integer("conviction_threshold").default(75).notNull(),
  risk_free_rate: numeric("risk_free_rate", { precision: 6, scale: 4 }).default("0.0400").notNull(),
  collateral_per_contract_usd: numeric("collateral_per_contract_usd", { precision: 18, scale: 2 }).default("500").notNull(),
  // [{ "symbol": "SPY", "class": "etf" }, { "symbol": "BTC", "class": "crypto" }]
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
    state: text("state").default("cash").notNull(), // "cash" | "holding_stock"
    shares: numeric("shares", { precision: 24, scale: 8 }).default("0").notNull(),
    cost_basis: numeric("cost_basis", { precision: 18, scale: 4 }), // per-share when holding
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
  opened_at: timestamp("opened_at").defaultNow().notNull(),
  settled_at: timestamp("settled_at"),
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
