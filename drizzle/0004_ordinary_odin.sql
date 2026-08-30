CREATE TABLE "ai_options_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"underlying" text NOT NULL,
	"action" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_options_orders_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "ai_options_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"underlying" text NOT NULL,
	"asset_class" text NOT NULL,
	"strategy" text NOT NULL,
	"side" text NOT NULL,
	"contract_symbol" text NOT NULL,
	"strike" numeric(18, 4) NOT NULL,
	"expiry" timestamp NOT NULL,
	"opt_type" text NOT NULL,
	"contracts" integer DEFAULT 1 NOT NULL,
	"contract_multiplier" numeric(18, 8) DEFAULT '100' NOT NULL,
	"entry_premium" numeric(18, 4) NOT NULL,
	"entry_spot" numeric(18, 4) NOT NULL,
	"collateral_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"greeks" jsonb,
	"council_verdict" text,
	"council_confidence" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"realized_pnl" numeric(18, 2),
	"exit_reason" text,
	"exit_premium" numeric(18, 4),
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	"broker_order_id" text
);
--> statement-breakpoint
CREATE TABLE "ai_options_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"kill_switch" boolean DEFAULT true NOT NULL,
	"paper" boolean DEFAULT true NOT NULL,
	"entries_enabled" boolean DEFAULT false NOT NULL,
	"risk_reducing_management_enabled" boolean DEFAULT false NOT NULL,
	"application_mode" text DEFAULT 'paper' NOT NULL,
	"broker_environment" text DEFAULT 'paper' NOT NULL,
	"broker_account_fingerprint" text,
	"reconciliation_max_age_seconds" integer DEFAULT 300 NOT NULL,
	"allocated_marked_nlv_limit_usd" numeric(18, 2) DEFAULT '6000' NOT NULL,
	"max_collateral_usd" numeric(18, 2) DEFAULT '6000' NOT NULL,
	"long_play_budget_usd" numeric(18, 2) DEFAULT '200' NOT NULL,
	"long_play_enabled" boolean DEFAULT true NOT NULL,
	"target_delta" integer DEFAULT 22 NOT NULL,
	"dte_min" integer DEFAULT 14 NOT NULL,
	"dte_max" integer DEFAULT 30 NOT NULL,
	"conviction_threshold" integer DEFAULT 75 NOT NULL,
	"risk_free_rate" numeric(6, 4) DEFAULT '0.0400' NOT NULL,
	"collateral_per_contract_usd" numeric(18, 2) DEFAULT '500' NOT NULL,
	"pmcc_leaps_delta" integer DEFAULT 80 NOT NULL,
	"pmcc_leaps_dte_min" integer DEFAULT 180 NOT NULL,
	"pmcc_leaps_dte_max" integer DEFAULT 365 NOT NULL,
	"pmcc_budget_usd" numeric(18, 2) DEFAULT '10000' NOT NULL,
	"account_size_usd" numeric(18, 2) DEFAULT '10000' NOT NULL,
	"whole_contracts" boolean DEFAULT false NOT NULL,
	"profit_take_pct" integer DEFAULT 60 NOT NULL,
	"roll_dte" integer DEFAULT 21 NOT NULL,
	"defensive_roll_delta" integer DEFAULT 40 NOT NULL,
	"earnings_blackout_days" integer DEFAULT 3 NOT NULL,
	"max_positions_per_sector" integer DEFAULT 2 NOT NULL,
	"short_dte_min" integer DEFAULT 30 NOT NULL,
	"short_dte_max" integer DEFAULT 45 NOT NULL,
	"pmcc_budget_pct" integer DEFAULT 60 NOT NULL,
	"commission_per_contract" numeric(8, 4) DEFAULT '0.65' NOT NULL,
	"slippage_pct" integer DEFAULT 3 NOT NULL,
	"leaps_roll_dte" integer DEFAULT 100 NOT NULL,
	"pmcc_watchlist" jsonb DEFAULT '["SOFI","F","AAL","PLTR","INTC","IWM"]'::jsonb NOT NULL,
	"auto_select_underlying" boolean DEFAULT false NOT NULL,
	"underlyings" jsonb DEFAULT '[{"symbol":"SPY","class":"etf"},{"symbol":"AAPL","class":"equity"},{"symbol":"BTC","class":"crypto"}]'::jsonb NOT NULL,
	"last_alert" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_options_wheel" (
	"user_id" uuid NOT NULL,
	"underlying" text NOT NULL,
	"state" text DEFAULT 'cash' NOT NULL,
	"shares" numeric(24, 8) DEFAULT '0' NOT NULL,
	"cost_basis" numeric(18, 4),
	"leaps_strike" numeric(18, 4),
	"leaps_expiry" timestamp,
	"leaps_net_debit" numeric(18, 4),
	"leaps_units" numeric(24, 8),
	"leaps_contract_symbol" text,
	"next_run_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_options_wheel_user_id_underlying_pk" PRIMARY KEY("user_id","underlying")
);
--> statement-breakpoint
CREATE TABLE "ai_token_schedule" (
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"next_run_at" timestamp NOT NULL,
	"consecutive_skips" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_token_schedule_user_id_token_pk" PRIMARY KEY("user_id","token")
);
--> statement-breakpoint
CREATE TABLE "ai_trade_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"venue" text NOT NULL,
	"side" text DEFAULT 'buy' NOT NULL,
	"usd_amount" numeric(18, 2) NOT NULL,
	"qty" numeric(24, 8),
	"price" numeric(18, 8),
	"boosted" boolean DEFAULT false NOT NULL,
	"council_verdict" text,
	"council_confidence" integer,
	"dip_depth_pct" numeric(8, 2),
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"exchange_order_id" text,
	"error" text,
	"gate_trace" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_trade_orders_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "ai_trading_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"kill_switch" boolean DEFAULT true NOT NULL,
	"monthly_cap_usd" numeric(18, 2) DEFAULT '1300' NOT NULL,
	"dca_amount_usd" numeric(18, 2) DEFAULT '150' NOT NULL,
	"boost_amount_usd" numeric(18, 2) DEFAULT '250' NOT NULL,
	"buy_zone_confidence" integer DEFAULT 65 NOT NULL,
	"sell_skip_threshold" integer DEFAULT 70 NOT NULL,
	"max_consecutive_skips" integer DEFAULT 1 NOT NULL,
	"tokens" jsonb DEFAULT '["BTC","ETH","SOL","HYPE"]'::jsonb NOT NULL,
	"token_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dip_trigger_enabled" boolean DEFAULT false NOT NULL,
	"dip_trigger_price" numeric(18, 2),
	"dip_trigger_amount" numeric(18, 2),
	"dip_trigger_fired" boolean DEFAULT false NOT NULL,
	"last_alert" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_pnl" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"bot" text NOT NULL,
	"realized_pnl" numeric(18, 2),
	"return_pct" numeric(10, 4),
	"activity_count" integer DEFAULT 0 NOT NULL,
	"equity" numeric(18, 2),
	"source" text DEFAULT 'snapshot' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_pnl_user_id_day_bot_pk" PRIMARY KEY("user_id","day","bot")
);
--> statement-breakpoint
CREATE TABLE "scanner_history" (
	"scanned_date" date NOT NULL,
	"coin_id" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"score_moonshot" integer NOT NULL,
	"score_scalp" integer NOT NULL,
	"rank_moonshot" integer NOT NULL,
	"rank_scalp" integer NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"mcap" numeric(18, 2) NOT NULL,
	"dims" jsonb NOT NULL,
	CONSTRAINT "scanner_history_scanned_date_coin_id_pk" PRIMARY KEY("scanned_date","coin_id")
);
--> statement-breakpoint
CREATE TABLE "scanner_watchlist" (
	"user_id" uuid NOT NULL,
	"coin_id" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scanner_watchlist_user_id_coin_id_pk" PRIMARY KEY("user_id","coin_id")
);
--> statement-breakpoint
CREATE TABLE "strategy_daily_observations" (
	"user_id" uuid NOT NULL,
	"strategy_key" text NOT NULL,
	"run_id" uuid NOT NULL,
	"day" date NOT NULL,
	"opening_marked_nlv" numeric(20, 6) NOT NULL,
	"closing_marked_nlv" numeric(20, 6) NOT NULL,
	"gross_realized_pnl" numeric(20, 6) NOT NULL,
	"net_realized_pnl" numeric(20, 6) NOT NULL,
	"unrealized_pnl" numeric(20, 6) NOT NULL,
	"gross_return" numeric(14, 8),
	"net_return" numeric(14, 8),
	"fees" numeric(20, 6) DEFAULT '0' NOT NULL,
	"spread_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"slippage_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"financing_funding" numeric(20, 6) DEFAULT '0' NOT NULL,
	"cash_flows" numeric(20, 6) DEFAULT '0' NOT NULL,
	"deposits" numeric(20, 6) DEFAULT '0' NOT NULL,
	"withdrawals" numeric(20, 6) DEFAULT '0' NOT NULL,
	"gross_exposure" numeric(20, 6) DEFAULT '0' NOT NULL,
	"net_exposure" numeric(20, 6) DEFAULT '0' NOT NULL,
	"drawdown" numeric(14, 8),
	"benchmark_return" numeric(14, 8),
	"volatility_matched_benchmark_return" numeric(14, 8),
	"reconciliation_status" text NOT NULL,
	"reconciliation_difference" numeric(20, 6),
	"reconciliation_difference_pct" numeric(14, 8),
	"activity_count" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"evidence_class" text NOT NULL,
	"observed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_daily_observations_user_id_strategy_key_run_id_day_pk" PRIMARY KEY("user_id","strategy_key","run_id","day")
);
--> statement-breakpoint
CREATE TABLE "strategy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"strategy_key" text NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_at" timestamp NOT NULL,
	"parent_trade_id" text,
	"pair_id" text,
	"leg_id" text,
	"symbol" text,
	"side" text,
	"quantity" numeric(24, 8),
	"price" numeric(24, 8),
	"gross_amount" numeric(20, 6),
	"fees" numeric(20, 6) DEFAULT '0' NOT NULL,
	"spread_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"slippage_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"financing_funding" numeric(20, 6) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"quote_source" text,
	"quote_at" timestamp,
	"price_provenance" text NOT NULL,
	"broker_reference" text,
	"source" text NOT NULL,
	"evidence_class" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_events_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "strategy_reconciliation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"strategy_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"broker" text NOT NULL,
	"environment" text NOT NULL,
	"account_fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"difference" numeric(20, 6),
	"difference_pct" numeric(14, 8),
	"positions" jsonb NOT NULL,
	"open_orders" jsonb NOT NULL,
	"mismatches" jsonb NOT NULL,
	"source" text NOT NULL,
	"snapshot_at" timestamp NOT NULL,
	"valid_until" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_reconciliation_snapshots_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "strategy_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_key" text NOT NULL,
	"implementation_version" text NOT NULL,
	"parameter_version" text NOT NULL,
	"parameter_hash" text NOT NULL,
	"mode" text NOT NULL,
	"lifecycle" text NOT NULL,
	"evidence_class" text NOT NULL,
	"inception_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"source" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_runs_identity_unique" UNIQUE("id","user_id","strategy_key")
);
--> statement-breakpoint
CREATE TABLE "vulcan_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"qty" numeric(20, 8) NOT NULL,
	"entry_price" numeric(18, 4) NOT NULL,
	"entry_date" timestamp NOT NULL,
	"still_open" boolean DEFAULT true NOT NULL,
	"exit_price" numeric(18, 4),
	"exit_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vulcan_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_date" date NOT NULL,
	"symbol" text NOT NULL,
	"sector" text NOT NULL,
	"rs_percentile" numeric(6, 3) NOT NULL,
	"ud_ratio" numeric(12, 4) NOT NULL,
	"ud_percentile" numeric(6, 3) NOT NULL,
	"stage2_eligible" boolean NOT NULL,
	"composite_score" numeric(6, 3) NOT NULL,
	"composite_rank" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_options_orders" ADD CONSTRAINT "ai_options_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_options_positions" ADD CONSTRAINT "ai_options_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_options_settings" ADD CONSTRAINT "ai_options_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_options_wheel" ADD CONSTRAINT "ai_options_wheel_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_token_schedule" ADD CONSTRAINT "ai_token_schedule_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_trade_orders" ADD CONSTRAINT "ai_trade_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_trading_settings" ADD CONSTRAINT "ai_trading_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pnl" ADD CONSTRAINT "daily_pnl_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scanner_watchlist" ADD CONSTRAINT "scanner_watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_daily_observations" ADD CONSTRAINT "strategy_daily_observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_daily_observations" ADD CONSTRAINT "strategy_daily_observations_run_identity_fk" FOREIGN KEY ("run_id","user_id","strategy_key") REFERENCES "public"."strategy_runs"("id","user_id","strategy_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_events" ADD CONSTRAINT "strategy_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_events" ADD CONSTRAINT "strategy_events_run_identity_fk" FOREIGN KEY ("run_id","user_id","strategy_key") REFERENCES "public"."strategy_runs"("id","user_id","strategy_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_reconciliation_snapshots" ADD CONSTRAINT "strategy_reconciliation_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_reconciliation_snapshots" ADD CONSTRAINT "strategy_reconciliation_run_identity_fk" FOREIGN KEY ("run_id","user_id","strategy_key") REFERENCES "public"."strategy_runs"("id","user_id","strategy_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_runs" ADD CONSTRAINT "strategy_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulcan_positions" ADD CONSTRAINT "vulcan_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_pnl_user_day_idx" ON "daily_pnl" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "scanner_history_symbol_idx" ON "scanner_history" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "scanner_history_date_idx" ON "scanner_history" USING btree ("scanned_date");--> statement-breakpoint
CREATE INDEX "scanner_watchlist_user_idx" ON "scanner_watchlist" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "strategy_daily_observations_user_day_idx" ON "strategy_daily_observations" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "strategy_events_run_event_idx" ON "strategy_events" USING btree ("run_id","event_at");--> statement-breakpoint
CREATE INDEX "strategy_events_parent_trade_idx" ON "strategy_events" USING btree ("parent_trade_id");--> statement-breakpoint
CREATE INDEX "strategy_events_pair_idx" ON "strategy_events" USING btree ("pair_id");--> statement-breakpoint
CREATE INDEX "strategy_reconciliation_run_snapshot_idx" ON "strategy_reconciliation_snapshots" USING btree ("run_id","snapshot_at");--> statement-breakpoint
CREATE INDEX "strategy_runs_user_strategy_idx" ON "strategy_runs" USING btree ("user_id","strategy_key");--> statement-breakpoint
CREATE INDEX "vulcan_scores_run_date_idx" ON "vulcan_scores" USING btree ("run_date");