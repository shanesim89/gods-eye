-- Durable per-(user, day, bot) P/L + activity snapshot for the 30-day calendar.
-- Hand-written additive migration: the drizzle journal is out-of-band (0004-0009
-- were applied manually), so this follows the same pattern. Idempotent — safe to
-- re-run. Apply via: node scripts/run_mig.mjs drizzle/0010_daily_pnl.sql
--
-- realized_pnl / return_pct nullable so we distinguish "bot has no realized-P/L
-- concept" (crypto DCA) from a genuine 0.00. `source` tags reconstructed rows
-- ('backfill') vs the daily cron ('snapshot'); the cron may later overwrite a
-- backfill row with an authoritative snapshot via the PK ON CONFLICT.
CREATE TABLE IF NOT EXISTS "daily_pnl" (
  "user_id"        uuid          NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "day"            date          NOT NULL,
  "bot"            text          NOT NULL,
  "realized_pnl"   numeric(18, 2),
  "return_pct"     numeric(10, 4),
  "activity_count" integer       NOT NULL DEFAULT 0,
  "equity"         numeric(18, 2),
  "source"         text          NOT NULL DEFAULT 'snapshot',
  "created_at"     timestamp     NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "day", "bot")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_pnl_user_day_idx" ON "daily_pnl" ("user_id", "day");
