ALTER TABLE "ai_trading_settings" ADD COLUMN "dip_trigger_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "ai_trading_settings" ADD COLUMN "dip_trigger_price" numeric(18, 2);
ALTER TABLE "ai_trading_settings" ADD COLUMN "dip_trigger_amount" numeric(18, 2);
ALTER TABLE "ai_trading_settings" ADD COLUMN "dip_trigger_fired" boolean DEFAULT false NOT NULL;
