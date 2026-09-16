import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { claimOrder } from "@/db/cap-claim";
import { ai_trading_settings, ai_trade_orders, assets } from "@/db/schema";
import { getPriceHistory } from "@/lib/market";
import { adapterFor, venueFor } from "./router";
import { newTrace } from "./gates";

const DROP_TRIGGER_PCT = 0.08;
const BUY_USD = 50;
// Mon=1 .. Thu=4 (UTC) — the only days a triggered drop is allowed to execute.
const EXEC_WEEKDAYS = new Set([1, 2, 3, 4]);

export type TokenOutcome = {
  token: string;
  status: "filled" | "failed" | "skipped";
  amount?: number;
  reason?: string;
};

export type DcaRunResult = {
  ran: boolean;
  reason?: string;
  outcomes: TokenOutcome[];
};

function periodKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Surface orders stuck in `pending` (claimed but never resolved → likely a crash
// mid-fill). They may correspond to a real on-chain buy, so we alert rather than
// auto-fail (auto-failing then re-buying next period risks a double buy).
const STALE_PENDING_MS = 60 * 60 * 1000; // 1h
async function alertStalePending(userId: string, now: Date) {
  const stale = await db
    .select({ id: ai_trade_orders.id, token: ai_trade_orders.token })
    .from(ai_trade_orders)
    .where(
      and(
        eq(ai_trade_orders.user_id, userId),
        eq(ai_trade_orders.status, "pending"),
        lt(ai_trade_orders.created_at, new Date(now.getTime() - STALE_PENDING_MS))
      )
    );
  if (stale.length > 0) {
    await setAlert(
      userId,
      `RECONCILE: ${stale.length} stuck pending order(s) [${stale.map((s) => s.token).join(", ")}] — verify on-chain before next run`
    );
  }
}

async function setAlert(userId: string, msg: string) {
  await db
    .update(ai_trading_settings)
    .set({ last_alert: `${new Date().toISOString()} — ${msg}`, updated_at: new Date() })
    .where(eq(ai_trading_settings.user_id, userId));
}

// Credit a filled buy into the holdings table the dashboard reads from.
// `assets` has no unique (user_id, ticker) key, so read-modify-write the crypto row.
// costUsd uses the actual fill (qty × avg price), not the requested amount.
async function creditHolding(userId: string, token: string, qty: number, costUsd: number) {
  const existing = await db
    .select({ id: assets.id, qty: assets.qty, cost_basis: assets.cost_basis })
    .from(assets)
    .where(and(eq(assets.user_id, userId), eq(assets.ticker, token), eq(assets.asset_class, "crypto")))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    const newQty = (row.qty ? parseFloat(row.qty) : 0) + qty;
    const newCost = (row.cost_basis ? parseFloat(row.cost_basis) : 0) + costUsd;
    await db
      .update(assets)
      .set({ qty: newQty.toFixed(8), cost_basis: newCost.toFixed(2), updated_at: new Date() })
      .where(eq(assets.id, row.id));
  } else {
    await db.insert(assets).values({
      user_id: userId,
      ticker: token,
      name: token,
      qty: qty.toFixed(8),
      cost_basis: costUsd.toFixed(2),
      currency: "USD",
      asset_class: "crypto",
    });
  }
}

// Core DCA engine for one user. Guardrail order:
// kill-switch → dip-trigger (one-shot) → per-token: weekday → 7d-rolling-high 8%-drop → claim → balance → execute.
export async function runDcaForUser(
  userId: string,
  opts: { force?: boolean } = {}
): Promise<DcaRunResult> {
  const settingsRows = await db
    .select()
    .from(ai_trading_settings)
    .where(eq(ai_trading_settings.user_id, userId))
    .limit(1);
  const settings = settingsRows[0];
  if (!settings) return { ran: false, reason: "no settings", outcomes: [] };

  // GUARDRAIL 1: master kill-switch.
  if (settings.kill_switch) return { ran: false, reason: "kill_switch active (halted)", outcomes: [] };

  const tokens = (settings.tokens as string[]) ?? [];
  const now = new Date();
  const outcomes: TokenOutcome[] = [];

  await alertStalePending(userId, now);

  // ── GUARDRAIL 2b: one-shot BTC-dip trigger ───────────────────────────────
  // When armed and BTC trades below the threshold, fire an UNCONDITIONAL buy of
  // dip_trigger_amount across every token — bypasses the weekday/drop-check
  // gates below (deliberate "buy the crash" event), still bounded by available
  // balance. Fires once, disarms, then this run returns so the normal
  // drop-check loop resumes on the next invocation (no double-spend same run).
  if (settings.dip_trigger_enabled && !settings.dip_trigger_fired) {
    const threshold = Number(settings.dip_trigger_price ?? 0);
    const dipAmount = Number(settings.dip_trigger_amount ?? 0);
    let btcPrice = 0;
    try {
      btcPrice = await adapterFor("BTC").getPrice("BTC");
    } catch {
      btcPrice = 0;
    }
    if (threshold > 0 && dipAmount > 0 && btcPrice > 0 && btcPrice < threshold) {
      // Re-arm nonce: settings.updated_at changes every time the user re-arms
      // (sets dip_trigger_fired=false), so the same threshold can fire again.
      const armNonce = settings.updated_at.getTime();
      for (const token of tokens) {
        const trace = newTrace().pass("kill_switch");
        const idemKey = `${userId}:${token}:dip:${threshold}:${armNonce}`;
        try {
          const claim = await claimOrder({
            userId, token, venue: venueFor(token), amountUsd: dipAmount, idemKey,
          });
          if (!claim.claimed) {
            outcomes.push({ token, status: "skipped", amount: dipAmount, reason: "dip: already bought" });
            continue;
          }
          const adapter = adapterFor(token);
          const balance = await adapter.getUsdBalance();
          if (balance < dipAmount) {
            await db.update(ai_trade_orders)
              .set({ status: "skipped", usd_amount: dipAmount.toFixed(2), error: `dip: insufficient balance ${balance} < ${dipAmount}`, gate_trace: trace.done() })
              .where(eq(ai_trade_orders.id, claim.orderId));
            outcomes.push({ token, status: "skipped", amount: dipAmount, reason: "dip: insufficient balance" });
            continue;
          }
          const fill = await adapter.marketBuy(token, dipAmount);
          const fillUsd = fill.qty * fill.price;
          await db.update(ai_trade_orders)
            .set({ status: "filled", usd_amount: fillUsd.toFixed(2), qty: fill.qty.toFixed(8), price: fill.price.toFixed(8), exchange_order_id: fill.orderId, gate_trace: trace.done() })
            .where(eq(ai_trade_orders.id, claim.orderId));
          await creditHolding(userId, token, fill.qty, fillUsd);
          outcomes.push({ token, status: "filled", amount: dipAmount, reason: "dip-buy" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          await db.update(ai_trade_orders)
            .set({ status: "failed", error: msg, gate_trace: trace.done() })
            .where(eq(ai_trade_orders.idempotency_key, idemKey));
          await setAlert(userId, `${token} DIP-BUY FAILED — ${msg}`);
          outcomes.push({ token, status: "failed", reason: msg });
        }
      }
      // One-shot: disarm so it never re-fires; the drop-check loop resumes next run.
      await db.update(ai_trading_settings)
        .set({
          dip_trigger_fired: true,
          last_alert: `${new Date().toISOString()} — BTC dip $${btcPrice} < $${threshold}: fired $${dipAmount} dip-buy across ${tokens.length} tokens`,
          updated_at: new Date(),
        })
        .where(eq(ai_trading_settings.user_id, userId));
      return { ran: true, reason: "dip-trigger fired", outcomes };
    }
  }

  // GUARDRAIL: armed-but-not-fired dip trigger is the first-ever buy. Block the
  // drop-check loop until it fires.
  if (settings.dip_trigger_enabled && !settings.dip_trigger_fired) {
    return {
      ran: false,
      reason: `waiting for BTC dip trigger ($${Number(settings.dip_trigger_price).toLocaleString()}) — blocked until first buy fires`,
      outcomes: [],
    };
  }

  const isExecDay = opts.force || EXEC_WEEKDAYS.has(now.getUTCDay());

  for (const token of tokens) {
    const trace = newTrace().pass("kill_switch");
    const idemKey = `${userId}:${token}:drop:${periodKey(now)}`;
    try {
      const adapter = adapterFor(token);
      const price = await adapter.getPrice(token);
      const history = await getPriceHistory(token, 7);
      const high = history && history.length > 0 ? Math.max(...history, price) : null;

      if (high == null) {
        trace.skip("weekday").skip("drop_check", "no 7d price history available");
        outcomes.push({ token, status: "skipped", reason: "no price history" });
        continue;
      }

      const dropPct = (high - price) / high;

      if (dropPct < DROP_TRIGGER_PCT) {
        trace
          .pass("weekday", isExecDay ? "Mon-Thu" : "weekend/Fri (monitoring only)")
          .skip("drop_check", `${(dropPct * 100).toFixed(2)}% below 7d high $${high.toFixed(2)} (need ${DROP_TRIGGER_PCT * 100}%)`);
        outcomes.push({ token, status: "skipped", reason: `drop ${(dropPct * 100).toFixed(1)}% < 8%` });
        continue;
      }

      if (!isExecDay) {
        trace
          .skip("weekday", "8% drop hit but execution only fires Mon-Thu (UTC)")
          .pass("drop_check", `${(dropPct * 100).toFixed(2)}% below 7d high $${high.toFixed(2)}`);
        outcomes.push({ token, status: "skipped", amount: BUY_USD, reason: "8% drop hit but not Mon-Thu" });
        continue;
      }

      trace
        .pass("weekday", "Mon-Thu")
        .pass("drop_check", `${(dropPct * 100).toFixed(2)}% below 7d high $${high.toFixed(2)}`);

      const claim = await claimOrder({ userId, token, venue: venueFor(token), amountUsd: BUY_USD, idemKey });
      if (!claim.claimed) {
        trace.skip("claim", "already bought today");
        outcomes.push({ token, status: "skipped", reason: "already processed today" });
        continue;
      }
      trace.pass("claim");

      const balance = await adapter.getUsdBalance();
      if (balance < BUY_USD) {
        trace.halt("balance", `insufficient: $${balance.toFixed(2)} < $${BUY_USD}`);
        await db
          .update(ai_trade_orders)
          .set({ status: "skipped", usd_amount: BUY_USD.toFixed(2), error: `insufficient balance: ${balance} < ${BUY_USD}`, gate_trace: trace.done() })
          .where(eq(ai_trade_orders.id, claim.orderId));
        await setAlert(userId, `${token} skipped — balance ${balance} < ${BUY_USD}`);
        outcomes.push({ token, status: "skipped", amount: BUY_USD, reason: "insufficient balance" });
        continue;
      }
      trace.pass("balance", `$${balance.toFixed(2)} available`);

      const fill = await adapter.marketBuy(token, BUY_USD);
      const fillUsd = fill.qty * fill.price; // actual notional (floor + slippage), not requested
      trace.pass("execute", `filled ${fill.qty.toFixed(8)} @ ${fill.price}`);
      await db
        .update(ai_trade_orders)
        .set({
          status: "filled",
          usd_amount: fillUsd.toFixed(2),
          qty: fill.qty.toFixed(8),
          price: fill.price.toFixed(8),
          exchange_order_id: fill.orderId,
          gate_trace: trace.done(),
        })
        .where(eq(ai_trade_orders.id, claim.orderId));

      await creditHolding(userId, token, fill.qty, fillUsd);
      outcomes.push({ token, status: "filled", amount: BUY_USD });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      await db
        .update(ai_trade_orders)
        .set({ status: "failed", error: msg, gate_trace: trace.done() })
        .where(eq(ai_trade_orders.idempotency_key, idemKey));
      await setAlert(userId, `${token} FAILED — ${msg}`);
      outcomes.push({ token, status: "failed", reason: msg });
    }
  }

  return { ran: true, outcomes };
}
