import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  jsonb,
  uuid,
  primaryKey,
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
