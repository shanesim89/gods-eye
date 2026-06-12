import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  ai_options_settings,
  ai_options_wheel,
  ai_options_positions,
  ai_options_orders,
} from "@/db/schema";
import { runCouncil } from "@/lib/council/run";
import { getPrice, getPriceHistory } from "@/lib/market";
import { histVol } from "./blackscholes";
import { selectCSP, selectCC, selectLongPlay, settle } from "./strategy";
import type { OptionsStrategyConfig } from "./strategy";
import type { Underlying } from "./settings";
import { newTrace, WHEEL_GATES } from "@/lib/trading/gates";

const WEEK_MS = 7 * 86_400_000;

export type OptionOutcome = {
  underlying: string;
  status: "opened_csp" | "opened_cc" | "opened_long" | "settled" | "skipped" | "failed";
  reason?: string;
  detail?: Record<string, unknown>;
};

export type OptionsRunResult = {
  ran: boolean;
  reason?: string;
  outcomes: OptionOutcome[];
};

function weekKey(d: Date): string {
  // ISO week start (Monday) as YYYY-MM-DD
  const ms = d.getTime();
  const day = d.getUTCDay() || 7;
  const monday = new Date(ms - (day - 1) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

async function setAlert(userId: string, msg: string) {
  await db
    .update(ai_options_settings)
    .set({ last_alert: `${new Date().toISOString()} — ${msg}`, updated_at: new Date() })
    .where(eq(ai_options_settings.user_id, userId));
}

export async function runOptionsForUser(
  userId: string,
  opts: { force?: boolean } = {}
): Promise<OptionsRunResult> {
  const settingsRows = await db
    .select()
    .from(ai_options_settings)
    .where(eq(ai_options_settings.user_id, userId))
    .limit(1);
  const settings = settingsRows[0];
  if (!settings) return { ran: false, reason: "no options settings", outcomes: [] };

  // GUARDRAIL 1: kill-switch.
  if (settings.kill_switch) return { ran: false, reason: "kill_switch active", outcomes: [] };

  const underlyings = (settings.underlyings as Underlying[]) ?? [];
  const now = new Date();
  const outcomes: OptionOutcome[] = [];

  const cfg: OptionsStrategyConfig = {
    targetDelta: settings.target_delta,
    dteMin: settings.dte_min,
    dteMax: settings.dte_max,
    riskFreeRate: parseFloat(settings.risk_free_rate),
    convictionThreshold: settings.conviction_threshold,
    longPlayBudgetUsd: parseFloat(settings.long_play_budget_usd),
    collateralPerContractUsd: parseFloat(settings.collateral_per_contract_usd),
  };

  // Wheel snapshot taken BEFORE settlement — used to read the cost basis of shares
  // being called away (that basis was set in a prior run, so the pre-settle snapshot
  // is correct). STEP 2 reloads a fresh snapshot after settlement.
  const wheelBeforeSettle = new Map(
    (await db.select().from(ai_options_wheel).where(eq(ai_options_wheel.user_id, userId))).map(
      (r) => [r.underlying, r]
    )
  );

  // ── STEP 1: settle any expired open positions ──────────────────────────────
  const expired = await db
    .select()
    .from(ai_options_positions)
    .where(
      and(
        eq(ai_options_positions.user_id, userId),
        eq(ai_options_positions.status, "open"),
        lte(ai_options_positions.expiry, now)
      )
    );

  for (const pos of expired) {
    try {
      const priceData = await getPrice(pos.underlying, pos.asset_class).catch(() => null);
      const spotAtExpiry = priceData?.price ?? parseFloat(pos.entry_spot);
      const ccCostBasis = wheelBeforeSettle.get(pos.underlying)?.cost_basis ?? null;
      const result = settle(
        pos.strategy as "csp" | "cc" | "long_call" | "long_put",
        parseFloat(pos.strike),
        parseFloat(pos.entry_premium),
        spotAtExpiry,
        pos.contracts,
        parseFloat(pos.contract_multiplier),
        ccCostBasis != null ? parseFloat(ccCostBasis) : undefined
      );

      await db
        .update(ai_options_positions)
        .set({
          status: result.status,
          realized_pnl: result.realizedPnl.toFixed(2),
          settled_at: now,
        })
        .where(eq(ai_options_positions.id, pos.id));

      // Wheel state transitions
      if (result.status === "assigned" && pos.strategy === "csp") {
        const assignedUnits = result.assignedUnits ?? parseFloat(pos.contract_multiplier);
        await db
          .insert(ai_options_wheel)
          .values({
            user_id: userId,
            underlying: pos.underlying,
            state: "holding_stock",
            shares: String(assignedUnits),
            cost_basis: String(result.newCostBasis ?? parseFloat(pos.strike)),
            updated_at: now,
          })
          .onConflictDoUpdate({
            target: [ai_options_wheel.user_id, ai_options_wheel.underlying],
            set: {
              state: "holding_stock",
              shares: String(assignedUnits),
              cost_basis: String(result.newCostBasis ?? parseFloat(pos.strike)),
              updated_at: now,
            },
          });
      } else if (result.status === "called_away" && pos.strategy === "cc") {
        await db
          .insert(ai_options_wheel)
          .values({
            user_id: userId,
            underlying: pos.underlying,
            state: "cash",
            shares: "0",
            cost_basis: null,
            updated_at: now,
          })
          .onConflictDoUpdate({
            target: [ai_options_wheel.user_id, ai_options_wheel.underlying],
            set: { state: "cash", shares: "0", cost_basis: null, updated_at: now },
          });
      }

      outcomes.push({
        underlying: pos.underlying,
        status: "settled",
        detail: { contractSymbol: pos.contract_symbol, result: result.status, pnl: result.realizedPnl },
      });
    } catch (err) {
      outcomes.push({
        underlying: pos.underlying,
        status: "failed",
        reason: `settle error: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  // ── STEP 2: per-underlying — wheel + long plays ───────────────────────────
  // Fresh wheel snapshot AFTER settlement so a position assigned/called this run
  // is acted on with its new state.
  const wheelRows = await db
    .select()
    .from(ai_options_wheel)
    .where(eq(ai_options_wheel.user_id, userId));
  const wheelByUnderlying = new Map(wheelRows.map((r) => [r.underlying, r]));

  // Running collateral total across all open CSPs (sum of strike×100 for open short puts)
  const openCollateralRow = await db
    .select({ total: sql<string>`coalesce(sum(${ai_options_positions.collateral_usd}), 0)` })
    .from(ai_options_positions)
    .where(
      and(
        eq(ai_options_positions.user_id, userId),
        eq(ai_options_positions.status, "open"),
        eq(ai_options_positions.strategy, "csp")
      )
    );
  const openCollateral = parseFloat(openCollateralRow[0]?.total ?? "0");
  const maxCollateral = parseFloat(settings.max_collateral_usd);

  // Long-play budget is a shared pool for this run, not per-trade — otherwise N
  // underlyings could each spend the full budget every week (M5).
  let longSpent = 0;

  for (const und of underlyings) {
    const { symbol, class: assetClass } = und;
    // Per-underlying gate trace, merged into the period_claim order row's detail.
    const trace = newTrace(WHEEL_GATES).pass("kill_switch").pass("settle", "expired positions settled");
    try {
      const wheel = wheelByUnderlying.get(symbol);
      const nextRun = wheel?.next_run_at ?? null;

      // GUARDRAIL 2: due-check.
      if (!opts.force && nextRun && nextRun > now) {
        outcomes.push({ underlying: symbol, status: "skipped", reason: "not due" });
        continue;
      }
      trace.pass("due", opts.force ? "forced run" : undefined);

      const idemKey = `${userId}:${symbol}:${weekKey(now)}`;

      // GUARDRAIL 3: idempotency.
      const claimed = await db
        .insert(ai_options_orders)
        .values({ user_id: userId, underlying: symbol, action: "period_claim", idempotency_key: idemKey, detail: {} })
        .onConflictDoNothing({ target: ai_options_orders.idempotency_key })
        .returning({ id: ai_options_orders.id });
      if (claimed.length === 0) {
        outcomes.push({ underlying: symbol, status: "skipped", reason: "already processed this week" });
        continue;
      }

      // GUARDRAIL 4: council on the underlying.
      // Map asset class to council AssetClass type (equity → stocks).
      const councilClass = assetClass === "equity" ? "stocks" : (assetClass as "etf" | "crypto");
      const verdict = await runCouncil(userId, councilClass, symbol);
      const priceData = await getPrice(symbol, assetClass).catch(() => null);
      const spot = priceData?.price;
      if (!spot || spot <= 0) {
        trace.halt("council", "no price for underlying");
        await db.update(ai_options_orders).set({ action: "skip", detail: { reason: "no price", gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
        outcomes.push({ underlying: symbol, status: "skipped", reason: "no price" });
        continue;
      }
      trace.pass("council", `${verdict.verdict} ${verdict.confidence}%`);

      const series = await getPriceHistory(symbol, 30).catch(() => null);
      const fallbackVol = assetClass === "crypto" ? 0.6 : 0.25;
      const sigma = histVol(series, fallbackVol);

      const state = wheel?.state ?? "cash";

      // ── WHEEL ACTION ──────────────────────────────────────────────────────
      if (state === "cash") {
        // Skip selling puts into a strong SELL signal (don't sell puts on declining underlyings)
        if (verdict.verdict === "SELL" && verdict.confidence >= cfg.convictionThreshold) {
          trace.halt("conviction", `SELL conf ${verdict.confidence} ≥ ${cfg.convictionThreshold} — skip CSP`);
          await db.update(ai_options_orders).set({ action: "skip", detail: { reason: "SELL signal — skip CSP", verdict: verdict.verdict, confidence: verdict.confidence, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
          outcomes.push({ underlying: symbol, status: "skipped", reason: `SELL signal (conf ${verdict.confidence}) — skip CSP` });
        } else {
          trace.pass("conviction", `${verdict.verdict} ${verdict.confidence}% — ok to sell puts`);
          const csp = selectCSP(symbol, spot, sigma, cfg);
          if (openCollateral + csp.collateralUsd > maxCollateral) {
            trace.halt("collateral", `$${(openCollateral + csp.collateralUsd).toFixed(0)} > cap $${maxCollateral.toFixed(0)}`);
            await db.update(ai_options_orders).set({ action: "skip", detail: { reason: "collateral cap", gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
            outcomes.push({ underlying: symbol, status: "skipped", reason: "collateral cap reached" });
          } else {
            await db.insert(ai_options_positions).values({
              user_id: userId,
              underlying: symbol,
              asset_class: assetClass,
              strategy: "csp",
              side: "short",
              contract_symbol: csp.contractSymbol,
              strike: csp.strike.toFixed(4),
              expiry: csp.expiry,
              opt_type: "P",
              contracts: 1,
              contract_multiplier: csp.multiplier.toFixed(8),
              entry_premium: csp.premium.toFixed(4),
              entry_spot: spot.toFixed(4),
              collateral_usd: csp.collateralUsd.toFixed(2),
              greeks: csp.greeks,
              council_verdict: verdict.verdict,
              council_confidence: verdict.confidence,
            });
            trace.pass("collateral", `$${csp.collateralUsd.toFixed(0)} reserved`);
            trace.pass("select_contract", `${csp.contractSymbol} Δ${csp.greeks.delta.toFixed(2)}`);
            trace.pass("execute", `CSP opened, premium $${csp.premiumTotal.toFixed(2)}`);
            await db.update(ai_options_orders).set({ action: "open_csp", detail: { symbol: csp.contractSymbol, strike: csp.strike, premium: csp.premium, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
            outcomes.push({ underlying: symbol, status: "opened_csp", detail: { contractSymbol: csp.contractSymbol, strike: csp.strike, premiumTotal: csp.premiumTotal, delta: csp.greeks.delta } });
          }
        }
      } else {
        // holding_stock → sell covered call against the exact held units.
        const costBasis = parseFloat(wheel?.cost_basis ?? "0");
        const heldUnits = parseFloat(wheel?.shares ?? "0");
        const cc = selectCC(symbol, spot, costBasis, heldUnits, sigma, cfg);
        await db.insert(ai_options_positions).values({
          user_id: userId,
          underlying: symbol,
          asset_class: assetClass,
          strategy: "cc",
          side: "short",
          contract_symbol: cc.contractSymbol,
          strike: cc.strike.toFixed(4),
          expiry: cc.expiry,
          opt_type: "C",
          contracts: 1,
          contract_multiplier: cc.multiplier.toFixed(8),
          entry_premium: cc.premium.toFixed(4),
          entry_spot: spot.toFixed(4),
          collateral_usd: "0",
          greeks: cc.greeks,
          council_verdict: verdict.verdict,
          council_confidence: verdict.confidence,
        });
        trace.pass("conviction", `${verdict.verdict} ${verdict.confidence}%`);
        trace.pass("collateral", "covered by held shares");
        trace.pass("select_contract", `${cc.contractSymbol} Δ${cc.greeks.delta.toFixed(2)}`);
        trace.pass("execute", `CC opened, premium $${cc.premiumTotal.toFixed(2)}`);
        await db.update(ai_options_orders).set({ action: "open_cc", detail: { symbol: cc.contractSymbol, strike: cc.strike, premium: cc.premium, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
        outcomes.push({ underlying: symbol, status: "opened_cc", detail: { contractSymbol: cc.contractSymbol, strike: cc.strike, premiumTotal: cc.premiumTotal } });
      }

      // ── LONG PLAY (independent of wheel, additive) ────────────────────────
      if (settings.long_play_enabled) {
        const longIdem = `${idemKey}:long`;
        const lp = selectLongPlay(symbol, verdict.verdict as "BUY" | "HOLD" | "SELL", verdict.confidence, spot, sigma, cfg);
        if (lp && longSpent + lp.premiumTotal > cfg.longPlayBudgetUsd) {
          // Pool exhausted — don't touch the wheel-action order row (would clobber its detail).
          outcomes.push({ underlying: symbol, status: "skipped", reason: "long-play budget pool exhausted" });
        } else if (lp) {
          const alreadyLong = await db
            .insert(ai_options_orders)
            .values({ user_id: userId, underlying: symbol, action: "open_long", idempotency_key: longIdem, detail: {} })
            .onConflictDoNothing({ target: ai_options_orders.idempotency_key })
            .returning({ id: ai_options_orders.id });
          if (alreadyLong.length > 0) {
            await db.insert(ai_options_positions).values({
              user_id: userId,
              underlying: symbol,
              asset_class: assetClass,
              strategy: lp.optType === "C" ? "long_call" : "long_put",
              side: "long",
              contract_symbol: lp.contractSymbol,
              strike: lp.strike.toFixed(4),
              expiry: lp.expiry,
              opt_type: lp.optType,
              contracts: 1,
              contract_multiplier: lp.multiplier.toFixed(8),
              entry_premium: lp.premium.toFixed(4),
              entry_spot: spot.toFixed(4),
              collateral_usd: "0",
              greeks: lp.greeks,
              council_verdict: verdict.verdict,
              council_confidence: verdict.confidence,
            });
            await db.update(ai_options_orders).set({ detail: { symbol: lp.contractSymbol, strike: lp.strike, premiumTotal: lp.premiumTotal } }).where(eq(ai_options_orders.idempotency_key, longIdem));
            longSpent += lp.premiumTotal;
            outcomes.push({ underlying: symbol, status: "opened_long", detail: { contractSymbol: lp.contractSymbol, verdict: verdict.verdict } });
          }
        }
      }

      // Advance next run +7d.
      const nextRun7 = new Date(now.getTime() + WEEK_MS);
      await db
        .insert(ai_options_wheel)
        .values({ user_id: userId, underlying: symbol, state: wheel?.state ?? "cash", shares: wheel?.shares ?? "0", cost_basis: wheel?.cost_basis ?? null, next_run_at: nextRun7, updated_at: now })
        .onConflictDoUpdate({
          target: [ai_options_wheel.user_id, ai_options_wheel.underlying],
          set: { next_run_at: nextRun7, updated_at: now },
        });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      await setAlert(userId, `OPTIONS ${symbol} FAILED — ${msg}`);
      outcomes.push({ underlying: symbol, status: "failed", reason: msg });
    }
  }

  return { ran: true, outcomes };
}
