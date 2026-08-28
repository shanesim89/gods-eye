-- Authoritative append-only strategy performance ledger and fail-closed Options controls.
-- Additive and idempotent. Apply only after local verification with:
--   node scripts/run_mig.mjs drizzle/0011_strategy_ledger.sql
-- daily_pnl remains a mutable compatibility projection and is not forward evidence.

ALTER TABLE "ai_options_settings"
  ADD COLUMN IF NOT EXISTS "entries_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "risk_reducing_management_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "application_mode" text NOT NULL DEFAULT 'paper',
  ADD COLUMN IF NOT EXISTS "broker_environment" text NOT NULL DEFAULT 'paper',
  ADD COLUMN IF NOT EXISTS "broker_account_fingerprint" text,
  ADD COLUMN IF NOT EXISTS "reconciliation_max_age_seconds" integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS "allocated_marked_nlv_limit_usd" numeric(18, 2) NOT NULL DEFAULT '6000';
--> statement-breakpoint

ALTER TABLE "ai_options_settings"
  ALTER COLUMN "max_collateral_usd" SET DEFAULT '6000';
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_options_settings_application_mode_check'
  ) THEN
    ALTER TABLE "ai_options_settings"
      ADD CONSTRAINT "ai_options_settings_application_mode_check"
      CHECK ("application_mode" IN ('paper', 'live'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_options_settings_broker_environment_check'
  ) THEN
    ALTER TABLE "ai_options_settings"
      ADD CONSTRAINT "ai_options_settings_broker_environment_check"
      CHECK ("broker_environment" IN ('paper', 'live'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_options_settings_reconciliation_age_check'
  ) THEN
    ALTER TABLE "ai_options_settings"
      ADD CONSTRAINT "ai_options_settings_reconciliation_age_check"
      CHECK ("reconciliation_max_age_seconds" > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_options_settings_marked_nlv_limit_check'
  ) THEN
    ALTER TABLE "ai_options_settings"
      ADD CONSTRAINT "ai_options_settings_marked_nlv_limit_check"
      CHECK ("allocated_marked_nlv_limit_usd" >= 0);
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "strategy_runs" (
  "id"                     uuid          PRIMARY KEY,
  "user_id"                uuid          NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "strategy_key"           text          NOT NULL,
  "implementation_version" text          NOT NULL,
  "parameter_version"      text          NOT NULL,
  "parameter_hash"         text          NOT NULL,
  "mode"                   text          NOT NULL CHECK ("mode" IN ('paper', 'live')),
  "lifecycle"              text          NOT NULL CHECK ("lifecycle" IN ('live', 'paper', 'benched', 'retired')),
  "evidence_class"         text          NOT NULL CHECK ("evidence_class" IN ('forward', 'historical_research', 'legacy_incomplete')),
  "inception_at"           timestamp     NOT NULL,
  "ended_at"               timestamp,
  "source"                 text          NOT NULL,
  "metadata"               jsonb,
  "created_at"             timestamp     NOT NULL DEFAULT now(),
  CONSTRAINT "strategy_runs_end_after_inception_check"
    CHECK ("ended_at" IS NULL OR "ended_at" >= "inception_at"),
  CONSTRAINT "strategy_runs_identity_unique"
    UNIQUE ("id", "user_id", "strategy_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategy_runs_user_strategy_idx"
  ON "strategy_runs" ("user_id", "strategy_key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "strategy_events" (
  "id"                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"           uuid          NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "run_id"            uuid          NOT NULL,
  "strategy_key"      text          NOT NULL,
  "event_type"        text          NOT NULL CHECK ("event_type" IN ('order_intent', 'execution', 'fill', 'trade', 'cash_flow', 'run_end')),
  "idempotency_key"   text          NOT NULL UNIQUE,
  "event_at"          timestamp     NOT NULL,
  "parent_trade_id"   text,
  "pair_id"           text,
  "leg_id"            text,
  "symbol"            text,
  "side"              text,
  "quantity"          numeric(24, 8),
  "price"             numeric(24, 8),
  "gross_amount"      numeric(20, 6),
  "fees"              numeric(20, 6) NOT NULL DEFAULT 0,
  "spread_cost"       numeric(20, 6) NOT NULL DEFAULT 0,
  "slippage_cost"     numeric(20, 6) NOT NULL DEFAULT 0,
  "financing_funding" numeric(20, 6) NOT NULL DEFAULT 0,
  "currency"          text          NOT NULL DEFAULT 'USD',
  "quote_source"      text,
  "quote_at"          timestamp,
  "price_provenance"  text          NOT NULL CHECK ("price_provenance" IN ('executable', 'modeled', 'journaled')),
  "broker_reference"  text,
  "source"            text          NOT NULL,
  "evidence_class"    text          NOT NULL CHECK ("evidence_class" IN ('forward', 'historical_research', 'legacy_incomplete')),
  "detail"            jsonb,
  "created_at"        timestamp     NOT NULL DEFAULT now(),
  CONSTRAINT "strategy_events_run_identity_fk"
    FOREIGN KEY ("run_id", "user_id", "strategy_key")
    REFERENCES "strategy_runs" ("id", "user_id", "strategy_key") ON DELETE CASCADE,
  CONSTRAINT "strategy_events_quote_provenance_check"
    CHECK (
      "price_provenance" <> 'executable'
      OR ("quote_source" IS NOT NULL AND "quote_at" IS NOT NULL)
    )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategy_events_run_event_idx"
  ON "strategy_events" ("run_id", "event_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategy_events_parent_trade_idx"
  ON "strategy_events" ("parent_trade_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategy_events_pair_idx"
  ON "strategy_events" ("pair_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "strategy_daily_observations" (
  "user_id"                              uuid          NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "strategy_key"                         text          NOT NULL,
  "run_id"                               uuid          NOT NULL,
  "day"                                  date          NOT NULL,
  "opening_marked_nlv"                   numeric(20, 6) NOT NULL,
  "closing_marked_nlv"                   numeric(20, 6) NOT NULL,
  "gross_realized_pnl"                   numeric(20, 6) NOT NULL,
  "net_realized_pnl"                     numeric(20, 6) NOT NULL,
  "unrealized_pnl"                       numeric(20, 6) NOT NULL,
  "gross_return"                         numeric(14, 8),
  "net_return"                           numeric(14, 8),
  "fees"                                 numeric(20, 6) NOT NULL DEFAULT 0,
  "spread_cost"                          numeric(20, 6) NOT NULL DEFAULT 0,
  "slippage_cost"                        numeric(20, 6) NOT NULL DEFAULT 0,
  "financing_funding"                    numeric(20, 6) NOT NULL DEFAULT 0,
  "cash_flows"                           numeric(20, 6) NOT NULL DEFAULT 0,
  "deposits"                             numeric(20, 6) NOT NULL DEFAULT 0,
  "withdrawals"                          numeric(20, 6) NOT NULL DEFAULT 0,
  "gross_exposure"                       numeric(20, 6) NOT NULL DEFAULT 0,
  "net_exposure"                         numeric(20, 6) NOT NULL DEFAULT 0,
  "drawdown"                             numeric(14, 8),
  "benchmark_return"                     numeric(14, 8),
  "volatility_matched_benchmark_return"  numeric(14, 8),
  "reconciliation_status"                text          NOT NULL CHECK ("reconciliation_status" IN ('reconciled', 'unreconciled', 'stale', 'degraded')),
  "reconciliation_difference"            numeric(20, 6),
  "reconciliation_difference_pct"        numeric(14, 8),
  "activity_count"                       integer       NOT NULL DEFAULT 0 CHECK ("activity_count" >= 0),
  "source"                               text          NOT NULL,
  "evidence_class"                       text          NOT NULL CHECK ("evidence_class" IN ('forward', 'historical_research', 'legacy_incomplete')),
  "observed_at"                          timestamp     NOT NULL,
  "created_at"                           timestamp     NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "strategy_key", "run_id", "day"),
  CONSTRAINT "strategy_daily_observations_run_identity_fk"
    FOREIGN KEY ("run_id", "user_id", "strategy_key")
    REFERENCES "strategy_runs" ("id", "user_id", "strategy_key") ON DELETE CASCADE,
  CONSTRAINT "strategy_daily_observations_drawdown_check"
    CHECK ("drawdown" IS NULL OR "drawdown" <= 0),
  CONSTRAINT "strategy_daily_observations_reconciliation_pct_check"
    CHECK ("reconciliation_difference_pct" IS NULL OR "reconciliation_difference_pct" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategy_daily_observations_user_day_idx"
  ON "strategy_daily_observations" ("user_id", "day");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "strategy_reconciliation_snapshots" (
  "id"                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"             uuid          NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "run_id"              uuid          NOT NULL,
  "strategy_key"        text          NOT NULL,
  "idempotency_key"     text          NOT NULL UNIQUE,
  "broker"              text          NOT NULL,
  "environment"         text          NOT NULL CHECK ("environment" IN ('paper', 'live')),
  "account_fingerprint" text          NOT NULL,
  "status"              text          NOT NULL CHECK ("status" IN ('reconciled', 'unreconciled', 'stale', 'degraded')),
  "difference"          numeric(20, 6),
  "difference_pct"      numeric(14, 8),
  "positions"           jsonb         NOT NULL,
  "open_orders"         jsonb         NOT NULL,
  "mismatches"          jsonb         NOT NULL,
  "source"              text          NOT NULL,
  "snapshot_at"         timestamp     NOT NULL,
  "valid_until"         timestamp     NOT NULL,
  "created_at"          timestamp     NOT NULL DEFAULT now(),
  CONSTRAINT "strategy_reconciliation_run_identity_fk"
    FOREIGN KEY ("run_id", "user_id", "strategy_key")
    REFERENCES "strategy_runs" ("id", "user_id", "strategy_key") ON DELETE CASCADE,
  CONSTRAINT "strategy_reconciliation_validity_check"
    CHECK ("valid_until" >= "snapshot_at"),
  CONSTRAINT "strategy_reconciliation_difference_pct_check"
    CHECK ("difference_pct" IS NULL OR "difference_pct" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategy_reconciliation_run_snapshot_idx"
  ON "strategy_reconciliation_snapshots" ("run_id", "snapshot_at");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "reject_strategy_ledger_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'strategy ledger rows are append-only'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  table_name text;
  trigger_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'strategy_runs',
    'strategy_events',
    'strategy_daily_observations',
    'strategy_reconciliation_snapshots'
  ]
  LOOP
    trigger_name := table_name || '_immutable';
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = trigger_name
        AND tgrelid = table_name::regclass
        AND NOT tgisinternal
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION reject_strategy_ledger_mutation()',
        trigger_name,
        table_name
      );
    END IF;
  END LOOP;
END $$;
