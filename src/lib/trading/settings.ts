import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_trading_settings } from "@/db/schema";

export type TradingSettings = typeof ai_trading_settings.$inferSelect;

// Get the user's trading settings, creating a safe-default row (HALTED) if absent.
export async function getOrCreateSettings(userId: string): Promise<TradingSettings> {
  const existing = await db
    .select()
    .from(ai_trading_settings)
    .where(eq(ai_trading_settings.user_id, userId))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const inserted = await db
    .insert(ai_trading_settings)
    .values({ user_id: userId }) // defaults: kill_switch=true, $150/$250, conf 65, 4 tokens
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return inserted[0];

  // Lost a race — read the row the other writer created.
  const row = await db
    .select()
    .from(ai_trading_settings)
    .where(eq(ai_trading_settings.user_id, userId))
    .limit(1);
  return row[0];
}
