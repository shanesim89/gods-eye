import "server-only";
import { db } from "@/db/client";
import { assets } from "@/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getPrice } from "@/lib/market";

const TICKERABLE = ["equity", "etf", "crypto"] as const;
const STALE_MS = 10 * 60 * 1000; // 10 min

export type RefreshResult = { refreshed: number; skipped: number; failed: number; total: number };

/**
 * Refresh live prices for all tickerable assets of a user.
 * - force=true: ignore staleness, refresh everything.
 * - force=false (default): skip rows priced within last 10min.
 */
export async function refreshUserAssets(
  userId: string,
  opts: { force?: boolean } = {}
): Promise<RefreshResult> {
  const force = opts.force ?? false;

  const rows = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.user_id, userId),
        eq(assets.auto_price, true),
        isNotNull(assets.ticker),
        inArray(assets.asset_class, [...TICKERABLE])
      )
    );

  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.ticker) {
      skipped++;
      continue;
    }
    if (!force && row.last_priced_at) {
      const age = Date.now() - new Date(row.last_priced_at).getTime();
      if (age < STALE_MS) {
        skipped++;
        continue;
      }
    }
    const q = await getPrice(row.ticker, row.asset_class, row.currency);
    if (!q) {
      failed++;
      continue;
    }
    const now = new Date();
    // Price stored as native — display layer FX-converts via lib/fx.ts
    await db
      .update(assets)
      .set({
        current_value: String(q.price),
        last_priced_at: now,
        updated_at: now,
        // If the provider returned a different currency than the asset.currency,
        // we still store the raw price. The displayed conversion uses asset.currency.
        // Note: for equity/etf assume Finnhub returns USD; user is responsible to set currency=USD for US tickers.
      })
      .where(and(eq(assets.id, row.id), eq(assets.user_id, userId)));
    refreshed++;
  }

  return { refreshed, skipped, failed, total: rows.length };
}

export async function hasStaleAssets(userId: string, thresholdMs = 30 * 60 * 1000): Promise<boolean> {
  const rows = await db
    .select({ id: assets.id, last_priced_at: assets.last_priced_at })
    .from(assets)
    .where(
      and(
        eq(assets.user_id, userId),
        eq(assets.auto_price, true),
        isNotNull(assets.ticker),
        inArray(assets.asset_class, [...TICKERABLE])
      )
    );
  if (rows.length === 0) return false;
  return rows.some((r) => {
    if (!r.last_priced_at) return true;
    return Date.now() - new Date(r.last_priced_at).getTime() > thresholdMs;
  });
}
