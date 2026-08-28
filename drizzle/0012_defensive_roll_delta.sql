-- Defensive delta-based roll trigger for options short legs (csp/cc/pmcc_short).
-- Additive, idempotent.
ALTER TABLE "ai_options_settings" ADD COLUMN IF NOT EXISTS "defensive_roll_delta" integer DEFAULT 40 NOT NULL;
