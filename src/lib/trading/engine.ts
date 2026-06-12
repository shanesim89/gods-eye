import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { atomicCapClaim } from "@/db/cap-claim";
import { ai_trading_settings, ai_token_schedule, ai_trade_orders, assets } from "@/db/schema";
import { runCouncil } from "@/lib/council/run";
import { adapterFor, venueFor } from "./router";
import { evaluateBuyZone, orderAmountUsd } from "./buy-zone";
import { newTrace } from "./gates";

const DEFAULT_CADENCE_DAYS = 14;
const DAY_MS = 86_400_000;

export type TokenOutcome = {
  token: string;
  status: "filled" | "failed" | "skipped";
  amount?: number;
  boosted?: boolean;
  reason?: string;
};

export type DcaRunResult = {
  ran: boolean;
  reason?: string;
  outcomes: TokenOutcome[];
};

function periodKey(due: Date): string {
  return due.toISOString().slice(0, 10);
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
// kill-switch → due → idempotency claim → council → buy-zone → cap → balance → execute.
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
  const cap = parseFloat(settings.monthly_cap_usd);
  const dca = parseFloat(settings.dca_amount_usd);
  const boost = parseFloat(settings.boost_amount_usd);
  const minConf = settings.buy_zone_confidence;
  const overrides = (settings.token_overrides as Record<string, { max_price?: number; cadence_days?: number }>) ?? {};
  const now = new Date();

  const outcomes: TokenOutcome[] = [];

  await alertStalePending(userId, now);

  const schedRows = await db
    .select()
    .from(ai_token_schedule)
    .where(eq(ai_token_schedule.user_id, userId));
  const schedByToken = new Map(schedRows.map((r) => [r.token, r]));

  for (const token of tokens) {
    // Per-run gate trace, persisted onto whatever order row this iteration writes.
    const trace = newTrace().pass("kill_switch");
    try {
      const sched = schedByToken.get(token);
      const due = sched?.next_run_at ?? now; // missing schedule → due now (first run)

      // GUARDRAIL 2: due-check (per-token 14-day cadence).
      if (!opts.force && due > now) {
        outcomes.push({ token, status: "skipped", reason: "not due" });
        continue;
      }
      trace.pass("due", opts.force ? "forced run" : undefined);

      const idemKey = `${userId}:${token}:${periodKey(due)}`;
      const adapter = adapterFor(token);
      const cadenceDays = overrides[token]?.cadence_days ?? DEFAULT_CADENCE_DAYS;

      // GUARDRAIL 3b: per-token price ceiling — checked BEFORE council so we don't
      // pay council cost (≈9 Anthropic calls) on tokens that will skip anyway.
      // Price-ceiling skips don't claim an order row; schedule update is sufficient.
      const price = await adapter.getPrice(token);
      const maxPrice = overrides[token]?.max_price;
      if (maxPrice !== undefined && price > maxPrice) {
        const recheckAt = new Date(now.getTime() + DAY_MS);
        await db
          .insert(ai_token_schedule)
          .values({ user_id: userId, token, next_run_at: recheckAt, consecutive_skips: 0 })
          .onConflictDoUpdate({
            target: [ai_token_schedule.user_id, ai_token_schedule.token],
            set: { next_run_at: recheckAt, updated_at: now },
          });
        await setAlert(userId, `${token} skipped — price ${price} above ceiling ${maxPrice}, recheck ${recheckAt.toISOString().slice(0, 10)}`);
        outcomes.push({ token, status: "skipped", reason: `price ${price} > max ${maxPrice} (daily recheck)` });
        continue;
      }
      trace.pass("price_ceiling", maxPrice !== undefined ? `price ${price} ≤ ceiling ${maxPrice}` : "no ceiling set");

      // Council (in-process, cached) → verdict. Only reached when price ≤ ceiling.
      const verdict = await runCouncil(userId, "crypto", token);
      trace.pass("council", `${verdict.verdict} ${verdict.confidence}%`);

      // GUARDRAIL 3c: SELL-skip gate — skip period if strong SELL and skips not maxed.
      const sellThreshold = (settings.sell_skip_threshold as number | null) ?? 70;
      const maxSkips = (settings.max_consecutive_skips as number | null) ?? 1;
      const consecutiveSkips = sched?.consecutive_skips ?? 0;

      if (
        verdict.verdict === "SELL" &&
        verdict.confidence >= sellThreshold &&
        consecutiveSkips < maxSkips
      ) {
        const nextRun = new Date(due.getTime() + cadenceDays * DAY_MS);
        trace.halt("sell_skip", `SELL conf ${verdict.confidence} ≥ ${sellThreshold} — period skipped (${consecutiveSkips + 1}/${maxSkips})`);
        // Direct insert as skipped — no pending claim needed for SELL-skip audit rows.
        await db
          .insert(ai_trade_orders)
          .values({
            user_id: userId,
            token,
            venue: venueFor(token),
            usd_amount: dca.toFixed(2),
            status: "skipped" as unknown as string,
            idempotency_key: `${idemKey}:sell-skip`,
            council_verdict: verdict.verdict,
            council_confidence: verdict.confidence,
            error: `SELL-skip: conf ${verdict.confidence} >= ${sellThreshold}`,
            gate_trace: trace.done(),
          })
          .onConflictDoNothing({ target: ai_trade_orders.idempotency_key });
        await db
          .insert(ai_token_schedule)
          .values({ user_id: userId, token, next_run_at: nextRun, consecutive_skips: consecutiveSkips + 1 })
          .onConflictDoUpdate({
            target: [ai_token_schedule.user_id, ai_token_schedule.token],
            set: { next_run_at: nextRun, consecutive_skips: consecutiveSkips + 1, updated_at: now },
          });
        await setAlert(userId, `${token} SELL-skipped (conf ${verdict.confidence}) — next run ${nextRun.toISOString().slice(0, 10)}`);
        outcomes.push({ token, status: "skipped", reason: `SELL signal (conf ${verdict.confidence})` });
        continue;
      }

      trace.pass("sell_skip", verdict.verdict === "SELL" ? "SELL but skips maxed or below threshold" : "no strong SELL");

      const bz = evaluateBuyZone(verdict, price, minConf);
      const { amount, boosted } = orderAmountUsd(bz.isBuyZone, dca, boost);
      trace.pass("buy_zone", boosted ? `buy-zone hit — boosted $${amount}` : `base size $${amount}`);

      // GUARDRAIL 4: atomic monthly cap check + idempotency claim in one serializable
      // transaction. Concurrent cron runs serialize here — no double-buy on stale data.
      const claim = await atomicCapClaim({
        userId,
        token,
        venue: venueFor(token),
        amountUsd: amount,
        capUsd: cap,
        idemKey,
        dcaAmountUsd: dca,
      });

      if (!claim.claimed) {
        if (claim.reason === "cap_exceeded") {
          await setAlert(userId, `${token} skipped — monthly cap reached`);
          outcomes.push({ token, status: "skipped", amount, reason: "monthly cap" });
        } else {
          outcomes.push({ token, status: "skipped", reason: "already processed this period" });
        }
        continue;
      }

      const { orderId } = claim;
      trace.pass("monthly_cap", `$${claim.spentAfter.toFixed(2)} after this order`);

      // GUARDRAIL 5: min exchange balance.
      const balance = await adapter.getUsdBalance();
      if (balance < amount) {
        trace.halt("balance", `insufficient: $${balance.toFixed(2)} < $${amount.toFixed(2)}`);
        await db
          .update(ai_trade_orders)
          .set({
            status: "skipped",
            usd_amount: amount.toFixed(2),
            boosted,
            council_verdict: verdict.verdict,
            council_confidence: verdict.confidence,
            dip_depth_pct: bz.dipDepthPct != null ? bz.dipDepthPct.toFixed(2) : null,
            error: `insufficient balance: ${balance} < ${amount}`,
            gate_trace: trace.done(),
          })
          .where(eq(ai_trade_orders.id, orderId));
        await setAlert(userId, `${token} skipped — balance ${balance} < ${amount}`);
        outcomes.push({ token, status: "skipped", amount, reason: "insufficient balance" });
        continue;
      }

      trace.pass("balance", `$${balance.toFixed(2)} available`);

      // Execute.
      const fill = await adapter.marketBuy(token, amount);
      const fillUsd = fill.qty * fill.price; // actual notional (floor + slippage), not requested
      trace.pass("execute", `filled ${fill.qty.toFixed(8)} @ ${fill.price}`);
      await db
        .update(ai_trade_orders)
        .set({
          status: "filled",
          usd_amount: fillUsd.toFixed(2),
          qty: fill.qty.toFixed(8),
          price: fill.price.toFixed(8),
          boosted,
          council_verdict: verdict.verdict,
          council_confidence: verdict.confidence,
          dip_depth_pct: bz.dipDepthPct != null ? bz.dipDepthPct.toFixed(2) : null,
          exchange_order_id: fill.orderId,
          gate_trace: trace.done(),
        })
        .where(eq(ai_trade_orders.id, orderId));

      // Reflect the fill in holdings so the dashboard shows real position + P&L.
      await creditHolding(userId, token, fill.qty, fillUsd);

      // Advance cadence: next run from now, reset skip counter.
      const nextRun = new Date(now.getTime() + cadenceDays * DAY_MS);
      await db
        .insert(ai_token_schedule)
        .values({ user_id: userId, token, next_run_at: nextRun, consecutive_skips: 0 })
        .onConflictDoUpdate({
          target: [ai_token_schedule.user_id, ai_token_schedule.token],
          set: { next_run_at: nextRun, consecutive_skips: 0, updated_at: now },
        });

      outcomes.push({ token, status: "filled", amount, boosted });
    } catch (err) {
      // GUARDRAIL 6: halt-on-error — mark failed, alert, never retry this period, continue to next token.
      const msg = err instanceof Error ? err.message : "unknown error";
      const idemKey = `${userId}:${token}:${periodKey(schedByToken.get(token)?.next_run_at ?? now)}`;
      // trace was mutated up to the gate that threw; remaining gates read not_reached.
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
