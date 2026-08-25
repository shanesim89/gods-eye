import "server-only";
import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_options_positions } from "@/db/schema";
import type { OptionsStrategyContext } from "../strategy-context";
import {
  appendOptionExecution,
  appendOptionFillTradeCashFlow,
  appendOptionOrderIntent,
} from "../strategy-ledger";
import type { OptionsBroker } from "./broker";

// Wires kill_switch to actually cancel/flatten LIVE state, not just halt the
// cron loop (live-readiness milestone "kill_switch_live"). Previously
// kill_switch only stopped the engine from opening anything NEW next run —
// any already-open live order or position just sat there untouched, which
// defeats the point of an emergency stop.
//
// Idempotent by construction: it only acts on status='open' rows with
// broker_order_id set, and flips them to 'closed' once flattened — so a
// kill_switch left on across many cron ticks doesn't re-attempt closes on
// positions it already closed. No separate claim/lock needed.
//
// All our live legs are SHORT (sell_to_open CSP/CC) — flattening means
// buy_to_close at market (urgency over price: this is an emergency stop, not
// a normal position exit). If a close order doesn't fill immediately, it's
// left resting at the broker rather than cancelled — cancelling would defeat
// the point of a flatten (silently leaves risk on), so the loop just reports
// it as unresolved for the next tick to retry.

export type FlattenResult =
  | { positionId: string; underlying: string; outcome: "closed"; realizedPnl: number }
  | { positionId: string; underlying: string; outcome: "unresolved"; reason: string };

export async function flattenLiveNow(
  userId: string,
  cfg: { wholeContracts: boolean; commissionPerContract: number },
  broker: OptionsBroker,
  context: OptionsStrategyContext,
): Promise<FlattenResult[]> {
  await broker.cancelAllOrders().catch(() => null); // stop anything pending from filling further

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

  const now = new Date();
  const results: FlattenResult[] = [];

  for (const pos of liveOpen) {
    const authorization = context.canReduceExposure(true);
    if (!authorization.allowed) {
      results.push({
        positionId: pos.id,
        underlying: pos.underlying,
        outcome: "unresolved",
        reason: `management denied: ${authorization.reasons.join(", ")}`,
      });
      continue;
    }

    const actionId = `kill_switch:${pos.id}`;
    await appendOptionOrderIntent(userId, context, {
      actionId,
      eventAt: now,
      symbol: pos.contract_symbol,
      side: "buy_to_close",
      quantity: pos.contracts,
      priceProvenance: "executable",
      detail: { positionId: pos.id, reason: "kill_switch" },
    });

    // Recheck immediately before the exposure-changing broker action.
    const submitAuthorization = context.canReduceExposure(true);
    if (!submitAuthorization.allowed) {
      results.push({
        positionId: pos.id,
        underlying: pos.underlying,
        outcome: "unresolved",
        reason: `management denied before submission: ${submitAuthorization.reasons.join(", ")}`,
      });
      continue;
    }

    const order = await broker
      .placeOrder({ contractSymbol: pos.contract_symbol, side: "buy_to_close", contracts: pos.contracts })
      .catch(() => null);
    if (!order) {
      results.push({ positionId: pos.id, underlying: pos.underlying, outcome: "unresolved", reason: "placeOrder failed" });
      continue;
    }
    await appendOptionExecution(userId, context, {
      actionId,
      eventAt: now,
      symbol: pos.contract_symbol,
      side: "buy_to_close",
      quantity: order.filledContracts ?? pos.contracts,
      price: order.filledPrice,
      priceProvenance: "executable",
      brokerReference: order.brokerOrderId,
      status: order.status,
      detail: { positionId: pos.id, reason: "kill_switch" },
    });
    if (order.status !== "filled" || order.filledPrice == null) {
      results.push({ positionId: pos.id, underlying: pos.underlying, outcome: "unresolved", reason: `order ${order.status}, not filled yet` });
      continue;
    }
    const multiplier = parseFloat(pos.contract_multiplier);
    const filledContracts = order.filledContracts ?? pos.contracts;
    const soldFor = parseFloat(pos.entry_premium) * multiplier * filledContracts;
    const boughtBackFor = order.filledPrice * multiplier * filledContracts;
    const fees = cfg.wholeContracts ? cfg.commissionPerContract * filledContracts * 2 : 0; // open + close
    const realizedPnl = soldFor - boughtBackFor - fees;
    await appendOptionFillTradeCashFlow(userId, context, {
      actionId,
      eventAt: now,
      symbol: pos.contract_symbol,
      side: "buy_to_close",
      quantity: filledContracts,
      price: order.filledPrice,
      grossAmount: -boughtBackFor,
      fees,
      spreadCost: 0,
      slippageCost: 0,
      financingFunding: 0,
      priceProvenance: "executable",
      brokerReference: order.brokerOrderId,
      detail: { positionId: pos.id, reason: "kill_switch", realizedPnl },
    });
    await db
      .update(ai_options_positions)
      .set({ status: "closed", realized_pnl: realizedPnl.toFixed(2), exit_reason: "kill_switch", exit_premium: order.filledPrice.toFixed(4), settled_at: now })
      .where(eq(ai_options_positions.id, pos.id));
    results.push({ positionId: pos.id, underlying: pos.underlying, outcome: "closed", realizedPnl });
  }

  return results;
}
