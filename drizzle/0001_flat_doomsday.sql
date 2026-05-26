ALTER TABLE "assets" ADD COLUMN "current_value" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "income_sources" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "investment_commitments" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "monthly_payment" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "linked_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;