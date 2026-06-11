CREATE TABLE "ai_trading_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"kill_switch" boolean DEFAULT true NOT NULL,
	"monthly_cap_usd" numeric(18, 2) DEFAULT '1300' NOT NULL,
	"dca_amount_usd" numeric(18, 2) DEFAULT '150' NOT NULL,
	"boost_amount_usd" numeric(18, 2) DEFAULT '250' NOT NULL,
	"buy_zone_confidence" integer DEFAULT 65 NOT NULL,
	"tokens" jsonb DEFAULT '["BTC","ETH","SOL","HYPE"]'::jsonb NOT NULL,
	"last_alert" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_token_schedule" (
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"next_run_at" timestamp NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_trade_orders_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "ai_trading_settings" ADD CONSTRAINT "ai_trading_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_token_schedule" ADD CONSTRAINT "ai_token_schedule_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_trade_orders" ADD CONSTRAINT "ai_trade_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
