import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { dbWs } from "./client-ws";
import { ai_trade_orders } from "./schema";

export type ClaimResult =
  | { claimed: true; orderId: string; spentAfter: number }
  | { claimed: false; reason: "cap_exceeded" | "already_claimed"; spentAfter: number };

/**
 * Atomically check the monthly cap and insert the pending order row in one
 * serializable transaction. This prevents two concurrent cron invocations from
 * both passing the cap check on stale data and double-buying.
 *
 * Returns claimed=false with reason="already_claimed" when the idempotency_key
 * already exists (ON CONFLICT), so the engine treats it as a normal skip.
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

  return dbWs.transaction(async (tx) => {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    // Lock user's MTD order rows so concurrent transactions serialize here.
    const rows = await tx
      .select({ total: sql<string>`coalesce(sum(${ai_trade_orders.usd_amount}), '0')` })
      .from(ai_trade_orders)
      .where(
        and(
          eq(ai_trade_orders.user_id, userId),
          inArray(ai_trade_orders.status, ["filled", "pending"]),
          gte(ai_trade_orders.created_at, monthStart)
        )
      )
      .for("update");

    const spent = parseFloat(rows[0]?.total ?? "0");

    if (spent + amountUsd > capUsd) {
      return { claimed: false, reason: "cap_exceeded", spentAfter: spent };
    }

    // Claim the period slot.
    const inserted = await tx
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
  }, { isolationLevel: "serializable" });
}
