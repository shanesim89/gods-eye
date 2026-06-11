import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_options_settings } from "@/db/schema";

export type OptionsSettings = typeof ai_options_settings.$inferSelect;

export type Underlying = { symbol: string; class: "equity" | "etf" | "crypto" };

// Get the user's options settings, creating a safe-default row (HALTED, paper) if absent.
export async function getOrCreateOptionsSettings(userId: string): Promise<OptionsSettings> {
  const existing = await db
    .select()
    .from(ai_options_settings)
    .where(eq(ai_options_settings.user_id, userId))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const inserted = await db
    .insert(ai_options_settings)
    .values({ user_id: userId }) // defaults: kill_switch=true, paper=true, SPY/AAPL/BTC
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return inserted[0];

  // Lost a race — read the row the other writer created.
  const row = await db
    .select()
    .from(ai_options_settings)
    .where(eq(ai_options_settings.user_id, userId))
    .limit(1);
  return row[0];
}
