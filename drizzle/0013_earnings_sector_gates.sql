-- Earnings blackout + sector concentration cap for the options wheel/PMCC engine.
-- Additive, idempotent.
ALTER TABLE "ai_options_settings" ADD COLUMN IF NOT EXISTS "earnings_blackout_days" integer DEFAULT 3 NOT NULL;
ALTER TABLE "ai_options_settings" ADD COLUMN IF NOT EXISTS "max_positions_per_sector" integer DEFAULT 2 NOT NULL;
