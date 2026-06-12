-- Manual migration (apply via Neon SQL editor, same as 0004_ai_portfolio.sql).
-- Adds the per-run decision-gate trace to DCA order rows. Nullable: rows
-- written before this deploy render "trace unavailable" in the UI.
ALTER TABLE "ai_trade_orders" ADD COLUMN IF NOT EXISTS "gate_trace" jsonb;
