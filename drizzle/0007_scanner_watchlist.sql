CREATE TABLE IF NOT EXISTS "scanner_watchlist" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "coin_id" text NOT NULL,
  "symbol" text NOT NULL,
  "name" text NOT NULL,
  "added_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "scanner_watchlist_pkey" PRIMARY KEY ("user_id", "coin_id")
);

CREATE INDEX IF NOT EXISTS "scanner_watchlist_user_idx" ON "scanner_watchlist" ("user_id");
