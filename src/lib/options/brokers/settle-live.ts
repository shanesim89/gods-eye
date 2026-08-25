import "server-only";
import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_options_positions, ai_options_wheel } from "@/db/schema";
import type { OptionsStrategyContext } from "../strategy-context";
import { appendOptionLifecycle } from "../strategy-ledger";
import type { OptionsBroker } from "./broker";

// Real assignment/exercise/expiration handling for LIVE positions
// (broker_order_id set) — live-readiness milestone "assignment_handling".
//
// The existing STEP-1 settlement in engine.ts compares OUR OWN spot-price
// snapshot to the strike at expiry to guess assigned/called_away/expired.
// That's fine for simulated positions (there's no ground truth to check
// against), but for a real fill it's the wrong source of truth — the broker
// KNOWS what happened (Alpaca's activities feed: OPASN = assigned/exercised,
// OPEXP = expired worthless), including EARLY assignment, which a
// spot-at-expiry comparison can never catch because it only fires once
// pos.expiry <= now. This function checks ALL open live positions, not just
// expired ones, precisely so early assignment isn't missed.
//
// P&L math intentionally mirrors strategy.ts's settle() exactly (same
// credit/fees/capitalGain formulas) — only the TRIGGER differs (a confirmed
// broker event, not a spot-price guess). Not calling settle() directly to
// avoid coupling a well-tested pure function's signature to broker-specific
// activity parsing; the duplicated math is ~6 lines and intentionally kept
// in lockstep with settle()'s csp/cc branches.

export type LiveSettlement =
  | { positionId: string; underlying: string; strategy: "csp"; outcome: "expired_worthless" | "assigned"; realizedPnl: number }
  | { positionId: string; underlying: string; strategy: "cc"; outcome: "expired_worthless" | "called_away"; realizedPnl: number }
  | { positionId: string; underlying: string; strategy: string; outcome: "unresolved"; reason: string };

export async function syncLiveSettlements(
  userId: string,
  cfg: { wholeContracts: boolean; commissionPerContract: number },
  broker: OptionsBroker,
  context: OptionsStrategyContext,
): Promise<LiveSettlement[]> {
  const liveOpen = await db
    .select()
    .from(ai_options_positions)
    .where(
      and(
        eq(ai_options_positions.user_id, userId),
        eq(ai_options_positions.status, "open"),
        isNotNull(ai_options_positions.broker_order_id)
      )
    );
  if (liveOpen.length === 0) return [];

  const [brokerPositions, activities] = await Promise.all([broker.getPositions(), broker.getOptionActivities()]);
  const stillOpenAtBroker = new Set(brokerPositions.map((p) => p.contractSymbol));
  const results: LiveSettlement[] = [];
  const now = new Date();

  for (const pos of liveOpen) {
    if (stillOpenAtBroker.has(pos.contract_symbol)) continue; // no event yet, nothing to do

    const activity = activities.find((a) => a.contractSymbol === pos.contract_symbol);
    if (!activity) {
      // Gone from the broker's open positions but no matching activity found —
      // don't guess. Surface it (same signal reconcile.ts's missing_at_broker
      // gives) and leave the DB row open for a human to check.
      results.push({ positionId: pos.id, underlying: pos.underlying, strategy: pos.strategy, outcome: "unresolved", reason: "no matching activity record" });
      continue;
    }

    const multiplier = parseFloat(pos.contract_multiplier);
    const credit = parseFloat(pos.entry_premium) * multiplier * pos.contracts;
    const fees = cfg.wholeContracts ? cfg.commissionPerContract * pos.contracts : 0;
    const strike = parseFloat(pos.strike);

    const activityId = `${activity.activityType}:${activity.contractSymbol}:${activity.date}:${activity.qty}`;

    if (activity.activityType === "OPEXP") {
      const realizedPnl = credit - fees;
      await appendOptionLifecycle(userId, context, {
        actionId: `lifecycle:${pos.id}:${activityId}`,
        eventAt: now,
        symbol: pos.contract_symbol,
        side: "expiration",
        quantity: activity.qty,
        grossAmount: credit,
        fees,
        brokerReference: pos.broker_order_id,
        detail: { positionId: pos.id, activity, outcome: "expired_worthless", realizedPnl },
      });
      await db.update(ai_options_positions).set({ status: "expired_worthless", realized_pnl: realizedPnl.toFixed(2), exit_reason: "expiry", settled_at: now }).where(eq(ai_options_positions.id, pos.id));
      results.push({ positionId: pos.id, underlying: pos.underlying, strategy: pos.strategy as "csp", outcome: "expired_worthless", realizedPnl });
    } else if (activity.activityType === "OPASN" && pos.strategy === "csp") {
      const realizedPnl = credit - fees;
      await appendOptionLifecycle(userId, context, {
        actionId: `lifecycle:${pos.id}:${activityId}`,
        eventAt: now,
        symbol: pos.contract_symbol,
        side: "assignment",
        quantity: activity.qty,
        price: strike,
        grossAmount: credit - strike * multiplier * pos.contracts,
        fees,
        brokerReference: pos.broker_order_id,
        detail: { positionId: pos.id, activity, outcome: "assigned", realizedPnl },
      });
      await db.update(ai_options_positions).set({ status: "assigned", realized_pnl: realizedPnl.toFixed(2), exit_reason: "assigned_early", settled_at: now }).where(eq(ai_options_positions.id, pos.id));
      await db.insert(ai_options_wheel).values({ user_id: userId, underlying: pos.underlying, state: "holding_stock", shares: String(multiplier * pos.contracts), cost_basis: String(strike), updated_at: now })
        .onConflictDoUpdate({ target: [ai_options_wheel.user_id, ai_options_wheel.underlying], set: { state: "holding_stock", shares: String(multiplier * pos.contracts), cost_basis: String(strike), updated_at: now } });
      results.push({ positionId: pos.id, underlying: pos.underlying, strategy: "csp", outcome: "assigned", realizedPnl });
    } else if (activity.activityType === "OPASN" && pos.strategy === "cc") {
      const wheelRow = await db.select().from(ai_options_wheel).where(and(eq(ai_options_wheel.user_id, userId), eq(ai_options_wheel.underlying, pos.underlying))).limit(1);
      const costBasis = wheelRow[0]?.cost_basis != null ? parseFloat(wheelRow[0].cost_basis) : null;
      const capitalGain = costBasis != null ? (strike - costBasis) * multiplier * pos.contracts : 0;
      const realizedPnl = credit + capitalGain - fees;
      await appendOptionLifecycle(userId, context, {
        actionId: `lifecycle:${pos.id}:${activityId}`,
        eventAt: now,
        symbol: pos.contract_symbol,
        side: "call_away",
        quantity: activity.qty,
        price: strike,
        grossAmount: credit + strike * multiplier * pos.contracts,
        fees,
        brokerReference: pos.broker_order_id,
        detail: { positionId: pos.id, activity, outcome: "called_away", capitalGain, realizedPnl },
      });
      await db.update(ai_options_positions).set({ status: "called_away", realized_pnl: realizedPnl.toFixed(2), exit_reason: "assigned_early", settled_at: now }).where(eq(ai_options_positions.id, pos.id));
      await db.insert(ai_options_wheel).values({ user_id: userId, underlying: pos.underlying, state: "cash", shares: "0", cost_basis: null, updated_at: now })
        .onConflictDoUpdate({ target: [ai_options_wheel.user_id, ai_options_wheel.underlying], set: { state: "cash", shares: "0", cost_basis: null, updated_at: now } });
      results.push({ positionId: pos.id, underlying: pos.underlying, strategy: "cc", outcome: "called_away", realizedPnl });
    } else {
      results.push({ positionId: pos.id, underlying: pos.underlying, strategy: pos.strategy, outcome: "unresolved", reason: `unhandled activity_type ${activity.activityType}` });
    }
  }

  return results;
}
