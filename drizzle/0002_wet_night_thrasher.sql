ALTER TABLE "assets" ADD COLUMN "last_priced_at" timestamp;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "auto_price" boolean DEFAULT true NOT NULL;