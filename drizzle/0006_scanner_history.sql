-- Manual migration (apply via Neon SQL editor).
-- Adds per-coin daily score snapshots for the Moonshot Scanner.
CREATE TABLE IF NOT EXISTS "scanner_history" (
  "scanned_date"   date          NOT NULL,
  "coin_id"        text          NOT NULL,
  "symbol"         text          NOT NULL,
  "name"           text          NOT NULL,
  "score_moonshot" integer       NOT NULL,
  "score_scalp"    integer       NOT NULL,
  "rank_moonshot"  integer       NOT NULL,
  "rank_scalp"     integer       NOT NULL,
  "price"          numeric(18,8) NOT NULL,
  "mcap"           numeric(18,2) NOT NULL,
  "dims"           jsonb         NOT NULL,
  PRIMARY KEY ("scanned_date", "coin_id")
);
CREATE INDEX IF NOT EXISTS "scanner_history_symbol_idx" ON "scanner_history" ("symbol");
CREATE INDEX IF NOT EXISTS "scanner_history_date_idx"  ON "scanner_history" ("scanned_date");
