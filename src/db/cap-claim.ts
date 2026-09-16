import "server-only";
import { db } from "./client";
import { ai_trade_orders } from "./schema";

export type ClaimResult =
  | { claimed: true; orderId: string }
  | { claimed: false; reason: "already_claimed" };

/**
 * Insert the pending order row. Idempotency is enforced by the unique
 * constraint on idempotency_key — a duplicate insert silently no-ops via
 * onConflictDoNothing.
 * FOR UPDATE / WebSocket transactions are intentionally avoided: the Neon
 * pooled connection doesn't support row-level locks, and the single daily
 * cron (one Vercel function invocation at a time) makes serialization
 * unnecessary in practice.
 */
export async function claimOrder(opts: {
  userId: string;
  token: string;
  venue: string;
  amountUsd: number;
  idemKey: string;
}): Promise<ClaimResult> {
  const { userId, token, venue, amountUsd, idemKey } = opts;

  const inserted = await db
    .insert(ai_trade_orders)
    .values({
      user_id: userId,
      token,
      venue,
      usd_amount: amountUsd.toFixed(2),
      status: "pending" as unknown as string,
      idempotency_key: idemKey,
    })
    .onConflictDoNothing({ target: ai_trade_orders.idempotency_key })
    .returning({ id: ai_trade_orders.id });

  if (inserted.length === 0) {
    return { claimed: false, reason: "already_claimed" };
  }

  return { claimed: true, orderId: inserted[0].id };
}
