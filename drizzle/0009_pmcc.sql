-- PMCC (Poor Man's Covered Call) support.
-- Hand-written additive migration: the drizzle journal is out-of-band (0004-0008
-- were applied manually), so this follows the same pattern. Idempotent — safe to
-- re-run. Adds per-underlying diagonal config + LEAPS state tracking.

ALTER TABLE "ai_options_settings" ADD COLUMN IF NOT EXISTS "pmcc_leaps_delta" integer DEFAULT 80 NOT NULL;
ALTER TABLE "ai_options_settings" ADD COLUMN IF NOT EXISTS "pmcc_leaps_dte_min" integer DEFAULT 180 NOT NULL;
ALTER TABLE "ai_options_settings" ADD COLUMN IF NOT EXISTS "pmcc_leaps_dte_max" integer DEFAULT 365 NOT NULL;
ALTER TABLE "ai_options_settings" ADD COLUMN IF NOT EXISTS "pmcc_budget_usd" numeric(18, 2) DEFAULT '2000' NOT NULL;

ALTER TABLE "ai_options_wheel" ADD COLUMN IF NOT EXISTS "leaps_strike" numeric(18, 4);
ALTER TABLE "ai_options_wheel" ADD COLUMN IF NOT EXISTS "leaps_expiry" timestamp;
ALTER TABLE "ai_options_wheel" ADD COLUMN IF NOT EXISTS "leaps_net_debit" numeric(18, 4);
ALTER TABLE "ai_options_wheel" ADD COLUMN IF NOT EXISTS "leaps_units" numeric(24, 8);
ALTER TABLE "ai_options_wheel" ADD COLUMN IF NOT EXISTS "leaps_contract_symbol" text;
