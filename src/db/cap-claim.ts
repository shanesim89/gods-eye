import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { ai_trade_orders } from "./schema";

export type ClaimResult =
  | { claimed: true; orderId: string; spentAfter: number }
  | { claimed: false; reason: "cap_exceeded" | "already_claimed"; spentAfter: number };

/**
 * Check the monthly cap and insert the pending order row.
 * Idempotency is enforced by the unique constraint on idempotency_key —
 * a duplicate insert silently no-ops via onConflictDoNothing.
 * FOR UPDATE / WebSocket transactions are intentionally avoided: the Neon
 * pooled connection doesn't support row-level locks, and the single daily
 * cron (one Vercel function invocation at a time) makes serialization
 * unnecessary in practice.
 */
export async function atomicCapClaim(opts: {
  userId: string;
  token: string;
  venue: string;
  amountUsd: number;
  capUsd: number;
  idemKey: string;
  dcaAmountUsd: number;
}): Promise<ClaimResult> {
  const { userId, token, venue, amountUsd, capUsd, idemKey, dcaAmountUsd } = opts;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${ai_trade_orders.usd_amount}), '0')` })
    .from(ai_trade_orders)
    .where(
      and(
        eq(ai_trade_orders.user_id, userId),
        inArray(ai_trade_orders.status, ["filled", "pending"]),
        gte(ai_trade_orders.created_at, monthStart)
      )
    );

  const spent = parseFloat(rows[0]?.total ?? "0");

  if (spent + amountUsd > capUsd) {
    return { claimed: false, reason: "cap_exceeded", spentAfter: spent };
  }

  const inserted = await db
    .insert(ai_trade_orders)
    .values({
      user_id: userId,
      token,
      venue,
      usd_amount: dcaAmountUsd.toFixed(2),
      status: "pending" as unknown as string,
      idempotency_key: idemKey,
    })
    .onConflictDoNothing({ target: ai_trade_orders.idempotency_key })
    .returning({ id: ai_trade_orders.id });

  if (inserted.length === 0) {
    return { claimed: false, reason: "already_claimed", spentAfter: spent };
  }

  return { claimed: true, orderId: inserted[0].id, spentAfter: spent + amountUsd };
}
