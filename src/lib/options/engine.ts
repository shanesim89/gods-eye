import "server-only";
import { and, eq, lte, sql, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  ai_options_settings,
  ai_options_wheel,
  ai_options_positions,
  ai_options_orders,
} from "@/db/schema";
import { runCouncil } from "@/lib/council/run";
import { getPrice, getPriceHistory } from "@/lib/market";
import { bsGreeks, bsPrice, histVol, yearsTo } from "./blackscholes";
import type { OptType } from "./blackscholes";
import { ivVsHv } from "./analytics";
import { selectCSP, selectCC, selectLongPlay, selectLeaps, selectPmccShort, settle } from "./strategy";
import type { OptionsStrategyConfig, LegSelection } from "./strategy";
import { screenPmccCandidates, isTransientScreenerResult, type ScreenerResult } from "./screener";
import { fetchRealCSPQuote, fetchRealCCQuote, toLegSelection } from "./wheel-chain";
import { fetchDeribitCSPQuote, fetchDeribitCCQuote } from "./deribit-chain";
import { fetchAlpacaCSPQuote, fetchAlpacaCCQuote } from "./brokers/alpaca-chain";
import { AlpacaBroker } from "./brokers/alpaca";
import { syncLiveSettlements } from "./brokers/settle-live";
import { flattenLiveNow } from "./brokers/kill-switch";
import { isCryptoUnderlying } from "./symbol";
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

function cfgFromSettings(settings: typeof ai_options_settings.$inferSelect): OptionsStrategyConfig {
  return {
    targetDelta: settings.target_delta,
    dteMin: settings.dte_min,
    dteMax: settings.dte_max,
    riskFreeRate: parseFloat(settings.risk_free_rate),
    convictionThreshold: settings.conviction_threshold,
    longPlayBudgetUsd: parseFloat(settings.long_play_budget_usd),
    collateralPerContractUsd: parseFloat(settings.collateral_per_contract_usd),
    pmccLeapsDelta: settings.pmcc_leaps_delta,
    pmccLeapsDteMin: settings.pmcc_leaps_dte_min,
    pmccLeapsDteMax: settings.pmcc_leaps_dte_max,
    pmccBudgetUsd: parseFloat(settings.pmcc_budget_usd),
    accountSizeUsd: parseFloat(settings.account_size_usd),
    wholeContracts: settings.whole_contracts,
    shortDteMin: settings.short_dte_min,
    shortDteMax: settings.short_dte_max,
    pmccBudgetPct: settings.pmcc_budget_pct,
    profitTakePct: settings.profit_take_pct,
    rollDte: settings.roll_dte,
    commissionPerContract: parseFloat(settings.commission_per_contract),
    slippagePct: settings.slippage_pct,
  };
}

async function setAlert(userId: string, msg: string) {
  await db
    .update(ai_options_settings)
    .set({ last_alert: `${new Date().toISOString()} — ${msg}`, updated_at: new Date() })
    .where(eq(ai_options_settings.user_id, userId));
}

// Roll back this week's period_claim so a TRANSIENT failure (price-feed hiccup,
// off-hours $0 quotes, council error) retries on the next daily run instead of
// wedging the underlying for the whole ISO week. The claim is the weekly
// idempotency mutex; deleting it lets the next run re-attempt. Terminal decisions
// (opened, SELL-skip, genuinely over-budget) intentionally KEEP the claim so we
// don't hammer the feed. No-op if the claim was never inserted.
async function rollbackClaim(userId: string, idemKey: string) {
  await db
    .delete(ai_options_orders)
    .where(and(eq(ai_options_orders.user_id, userId), eq(ai_options_orders.idempotency_key, idemKey)));
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

  // GUARDRAIL 1: kill-switch. Also flattens any live state (cancel resting
  // orders, buy_to_close any open live positions) — halting the cron alone
  // isn't a real emergency stop if a live position is left running. Idempotent
  // (see kill-switch.ts), so this is safe to hit on every tick while the
  // switch stays on.
  if (settings.kill_switch) {
    const flattened = await flattenLiveNow(userId, {
      wholeContracts: settings.whole_contracts,
      commissionPerContract: parseFloat(settings.commission_per_contract),
    }).catch(() => []);
    return {
      ran: false,
      reason: "kill_switch active",
      outcomes: flattened.map((f) =>
        f.outcome === "closed"
          ? { underlying: f.underlying, status: "settled" as const, detail: { source: "kill_switch", realizedPnl: f.realizedPnl } }
          : { underlying: f.underlying, status: "skipped" as const, reason: `kill_switch flatten unresolved: ${f.reason}` }
      ),
    };
  }

  const underlyings = (settings.underlyings as Underlying[]) ?? [];
  const now = new Date();
  const outcomes: OptionOutcome[] = [];

  const cfg = cfgFromSettings(settings);

  // Wheel snapshot taken BEFORE settlement — used to read the cost basis of shares
  // being called away (that basis was set in a prior run, so the pre-settle snapshot
  // is correct). STEP 2 reloads a fresh snapshot after settlement.
  const wheelBeforeSettle = new Map(
    (await db.select().from(ai_options_wheel).where(eq(ai_options_wheel.user_id, userId))).map(
      (r) => [r.underlying, r]
    )
  );

  // ── STEP 0: settle LIVE positions using real broker events (assignment_handling
  // milestone) — must run before STEP 1 so a just-assigned wheel state (e.g. CSP
  // → holding_stock) is visible to the underlyings loop below. Checks ALL open
  // live positions, not just expired ones, so early assignment isn't missed.
  const liveSettlements = await syncLiveSettlements(userId, { wholeContracts: cfg.wholeContracts, commissionPerContract: cfg.commissionPerContract }).catch(() => []);
  for (const s of liveSettlements) {
    outcomes.push(
      s.outcome === "unresolved"
        ? { underlying: s.underlying, status: "skipped", reason: `live settlement unresolved (${s.strategy}): ${s.reason}` }
        : { underlying: s.underlying, status: "settled", detail: { source: "live", strategy: s.strategy, outcome: s.outcome, realizedPnl: s.realizedPnl } }
    );
  }

  // ── STEP 1: settle any expired open SIMULATED positions (spot-vs-strike guess —
  // broker_order_id IS NULL excludes live positions, which STEP 0 already
  // resolved from real broker truth above) ───────────────────────────────────
  const expired = await db
    .select()
    .from(ai_options_positions)
    .where(
      and(
        eq(ai_options_positions.user_id, userId),
        eq(ai_options_positions.status, "open"),
        lte(ai_options_positions.expiry, now),
        isNull(ai_options_positions.broker_order_id)
      )
    );

  for (const pos of expired) {
    try {
      const priceData = await getPrice(pos.underlying, pos.asset_class).catch(() => null);
      const spotAtExpiry = priceData?.price ?? parseFloat(pos.entry_spot);
      const ccCostBasis = wheelBeforeSettle.get(pos.underlying)?.cost_basis ?? null;
      const result = settle(
        pos.strategy as "csp" | "cc" | "long_call" | "long_put" | "pmcc_leaps" | "pmcc_short",
        parseFloat(pos.strike),
        parseFloat(pos.entry_premium),
        spotAtExpiry,
        pos.contracts,
        parseFloat(pos.contract_multiplier),
        ccCostBasis != null ? parseFloat(ccCostBasis) : undefined,
        cfg.wholeContracts ? cfg.commissionPerContract * pos.contracts : 0
      );

      await db
        .update(ai_options_positions)
        .set({
          status: result.status,
          realized_pnl: result.realizedPnl.toFixed(2),
          exit_reason: "expiry",
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
      } else if (pos.strategy === "pmcc_leaps") {
        // LEAPS expired/closed → diagonal is over, reset to pmcc_cash and clear LEAPS state.
        await db
          .update(ai_options_wheel)
          .set({
            state: "pmcc_cash",
            leaps_strike: null,
            leaps_expiry: null,
            leaps_net_debit: null,
            leaps_units: null,
            leaps_contract_symbol: null,
            updated_at: now,
          })
          .where(
            and(eq(ai_options_wheel.user_id, userId), eq(ai_options_wheel.underlying, pos.underlying))
          );
      }
      // pmcc_short settles (expired_worthless / called_away) with NO state change —
      // the LEAPS persists, next run sells another short call.

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

  // Whole-contracts mode: the book must fit inside the account. Capital committed =
  // CSP collateral + LEAPS debits across ALL open positions; what's left is the cash
  // available for new collateral/debits (keeps the ~(100−pmcc_budget_pct)% reserve honest).
  const openCapitalRow = await db
    .select({ total: sql<string>`coalesce(sum(${ai_options_positions.collateral_usd}), 0)` })
    .from(ai_options_positions)
    .where(
      and(eq(ai_options_positions.user_id, userId), eq(ai_options_positions.status, "open"))
    );
  const openCapital = parseFloat(openCapitalRow[0]?.total ?? "0");
  const availableCash = Math.max(0, cfg.accountSizeUsd - openCapital);

  // Long-play budget is a shared pool for this run, not per-trade — otherwise N
  // underlyings could each spend the full budget every week (M5).
  let longSpent = 0;

  // Screener runs at most once per run (lazily) and is shared across pmcc_cash slots.
  let screenerResult: ScreenerResult | null = null;
  // Track cash committed by screened buys within this run.
  let runCashUsed = 0;

  for (const und of underlyings) {
    const { symbol, class: assetClass } = und;
    // Hoisted so the catch can roll the weekly claim back on a transient failure.
    const idemKey = `${userId}:${symbol}:${weekKey(now)}`;
    // Per-underlying gate trace, merged into the period_claim order row's detail.
    const trace = newTrace(WHEEL_GATES).pass("kill_switch").pass("settle", "expired positions settled");
    try {
      const wheel = wheelByUnderlying.get(symbol);
      const nextRun = wheel?.next_run_at ?? null;

      // GUARDRAIL 1.5: whole-contracts realism — crypto options (Deribit, 1-coin
      // contracts) don't fit a $5-15k account. Skip cleanly rather than fake it.
      if (cfg.wholeContracts && assetClass === "crypto") {
        outcomes.push({ underlying: symbol, status: "skipped", reason: "not affordable at account size (whole contracts)" });
        continue;
      }

      // GUARDRAIL 2: due-check.
      if (!opts.force && nextRun && nextRun > now) {
        outcomes.push({ underlying: symbol, status: "skipped", reason: "not due" });
        continue;
      }
      trace.pass("due", opts.force ? "forced run" : undefined);

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
        // Transient (feed hiccup) — roll the claim back so the next run retries.
        trace.halt("council", "no price for underlying");
        await rollbackClaim(userId, idemKey);
        outcomes.push({ underlying: symbol, status: "skipped", reason: "no price (transient — will retry)" });
        continue;
      }
      trace.pass("council", `${verdict.verdict} ${verdict.confidence}%`);

      const mode = und.mode ?? "wheel";
      const state = wheel?.state ?? (mode === "pmcc" ? "pmcc_cash" : "cash");
      // Buying the LEAPS (pmcc_cash) is a debit purchase, not a premium sale — cheap
      // IV is favorable there, not a reason to skip. The IVR filter below exists to
      // stop selling premium (CSPs, covered calls) when IV is cheap; it must not
      // gate the "buy a LEAPS" decision, and must not use this slot's own IV to
      // gate the auto-select screener, which evaluates a different watchlist entirely.
      const skipIvrGate = mode === "pmcc" && state === "pmcc_cash";

      const series = await getPriceHistory(symbol, 30).catch(() => null);
      const fallbackVol = assetClass === "crypto" ? 0.6 : 0.25;
      const sigma = histVol(series, fallbackVol);

      // IVR proxy: compare 30-day HV vs 252-day HV band. Skip if IV appears cheap.
      const IVR_MIN = 40;
      if (skipIvrGate) {
        trace.pass("ivr", "buying LEAPS (debit) — cheap IV is favorable, filter not applicable");
      } else {
        const series252 = await getPriceHistory(symbol, 252).catch(() => null);
        const sigma252 = histVol(series252, fallbackVol);
        if (sigma252 > 0) {
          const ivrProxy = ivVsHv(sigma, sigma252);
          if (ivrProxy.proxyPctile < IVR_MIN) {
            trace.halt("ivr", `proxy ${ivrProxy.proxyPctile.toFixed(0)}% < ${IVR_MIN}% — cheap IV, skip`);
            await db.update(ai_options_orders).set({ action: "skip", detail: { reason: "IV too cheap", ivr_proxy: ivrProxy.proxyPctile, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
            outcomes.push({ underlying: symbol, status: "skipped", reason: `IV proxy ${ivrProxy.proxyPctile.toFixed(0)}% < ${IVR_MIN}% — cheap IV` });
            continue;
          }
          trace.pass("ivr", `proxy ${ivrProxy.proxyPctile.toFixed(0)}% ≥ ${IVR_MIN}%`);
        } else {
          trace.pass("ivr", "252d history unavailable — skipping filter");
        }
      }

      // ── PMCC ACTION (diagonal) ────────────────────────────────────────────
      if (mode === "pmcc") {
        if (state === "pmcc_holding_leaps") {
          // Sell a short call covered by the LEAPS.
          const leapsStrike = parseFloat(wheel?.leaps_strike ?? "0");
          const netDebit = parseFloat(wheel?.leaps_net_debit ?? "0");
          const leapsUnits = parseFloat(wheel?.leaps_units ?? "0");
          if (!leapsStrike || !leapsUnits) {
            // Inconsistent state (LEAPS data missing) — reset to pmcc_cash, buy fresh next run.
            trace.halt("select_contract", "LEAPS state missing — reset to pmcc_cash");
            await db.update(ai_options_wheel).set({ state: "pmcc_cash", updated_at: now }).where(and(eq(ai_options_wheel.user_id, userId), eq(ai_options_wheel.underlying, symbol)));
            await db.update(ai_options_orders).set({ action: "skip", detail: { reason: "LEAPS state missing", gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
            outcomes.push({ underlying: symbol, status: "skipped", reason: "LEAPS state missing — reset" });
          } else {
            const short = selectPmccShort(symbol, spot, leapsStrike, netDebit, leapsUnits, sigma, cfg);
            await db.insert(ai_options_positions).values({
              user_id: userId,
              underlying: symbol,
              asset_class: assetClass,
              strategy: "pmcc_short",
              side: "short",
              contract_symbol: short.contractSymbol,
              strike: short.strike.toFixed(4),
              expiry: short.expiry,
              opt_type: "C",
              contracts: 1,
              contract_multiplier: short.multiplier.toFixed(8),
              entry_premium: short.premium.toFixed(4),
              entry_spot: spot.toFixed(4),
              collateral_usd: "0",
              greeks: short.greeks,
              council_verdict: verdict.verdict,
              council_confidence: verdict.confidence,
            });
            trace.pass("conviction", `${verdict.verdict} ${verdict.confidence}%`);
            trace.pass("collateral", "covered by LEAPS");
            trace.pass("select_contract", `${short.contractSymbol} Δ${short.greeks.delta.toFixed(2)} (floor ${(leapsStrike + netDebit).toFixed(2)})`);
            trace.pass("execute", `PMCC short opened, premium $${short.premiumTotal.toFixed(2)}`);
            await db.update(ai_options_orders).set({ action: "open_pmcc_short", detail: { symbol: short.contractSymbol, strike: short.strike, premium: short.premium, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
            outcomes.push({ underlying: symbol, status: "opened_cc", detail: { contractSymbol: short.contractSymbol, strike: short.strike, premiumTotal: short.premiumTotal } });
          }
        } else {
          // pmcc_cash → buy the LEAPS (stock surrogate). Skip going long into a strong SELL.
          if (verdict.verdict === "SELL" && verdict.confidence >= cfg.convictionThreshold) {
            trace.halt("conviction", `SELL conf ${verdict.confidence} ≥ ${cfg.convictionThreshold} — skip LEAPS`);
            await db.update(ai_options_orders).set({ action: "skip", detail: { reason: "SELL signal — skip LEAPS", verdict: verdict.verdict, confidence: verdict.confidence, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
            outcomes.push({ underlying: symbol, status: "skipped", reason: `SELL signal (conf ${verdict.confidence}) — skip LEAPS` });
          } else {
            trace.pass("conviction", `${verdict.verdict} ${verdict.confidence}% — ok to buy LEAPS`);

            // ── Auto-select: screen the watchlist with REAL chains and buy the
            // top-ranked affordable LEAPS instead of the configured symbol. The
            // daily manage() covers it with a short call on its next run.
            if (settings.auto_select_underlying && cfg.wholeContracts && assetClass !== "crypto") {
              screenerResult ??= await screenPmccCandidates({
                watchlist: (settings.pmcc_watchlist as string[]) ?? [],
                accountSizeUsd: cfg.accountSizeUsd,
                pmccBudgetPct: cfg.pmccBudgetPct,
                leapsDelta: cfg.pmccLeapsDelta,
                leapsDteMin: cfg.pmccLeapsDteMin,
                leapsDteMax: cfg.pmccLeapsDteMax,
                shortDelta: cfg.targetDelta,
                shortDteMin: cfg.shortDteMin,
                shortDteMax: cfg.shortDteMax,
                now,
              });
              const cashLeft = availableCash - runCashUsed;
              // Skip candidates already holding a LEAPS (diagonal open under that symbol).
              const top = screenerResult.ranked.find(
                (c) => c.leapsDebitUsd <= cashLeft && wheelByUnderlying.get(c.symbol)?.state !== "pmcc_holding_leaps"
              );
              if (top) {
                const debit = top.leapsDebitUsd; // real ask × 100, no extra slippage
                await db.insert(ai_options_positions).values({
                  user_id: userId,
                  underlying: top.symbol,
                  asset_class: "equity",
                  strategy: "pmcc_leaps",
                  side: "long",
                  contract_symbol: `${top.symbol}-${top.leapsExpiry.toISOString().slice(2, 10).replace(/-/g, "")}C${top.leapsStrike}`,
                  strike: top.leapsStrike.toFixed(4),
                  expiry: top.leapsExpiry,
                  opt_type: "C",
                  contracts: 1,
                  contract_multiplier: "100",
                  entry_premium: top.leapsAsk.toFixed(4),
                  entry_spot: top.spot.toFixed(4),
                  collateral_usd: debit.toFixed(2),
                  greeks: { delta: top.leapsDelta, gamma: 0, theta: 0, vega: 0, iv: top.leapsIV },
                  council_verdict: verdict.verdict,
                  council_confidence: verdict.confidence,
                });
                await db
                  .insert(ai_options_wheel)
                  .values({
                    user_id: userId,
                    underlying: top.symbol,
                    state: "pmcc_holding_leaps",
                    leaps_strike: top.leapsStrike.toFixed(4),
                    leaps_expiry: top.leapsExpiry,
                    leaps_net_debit: top.leapsAsk.toFixed(4),
                    leaps_units: "100",
                    leaps_contract_symbol: `${top.symbol}-C${top.leapsStrike}`,
                    updated_at: now,
                  })
                  .onConflictDoUpdate({
                    target: [ai_options_wheel.user_id, ai_options_wheel.underlying],
                    set: {
                      state: "pmcc_holding_leaps",
                      leaps_strike: top.leapsStrike.toFixed(4),
                      leaps_expiry: top.leapsExpiry,
                      leaps_net_debit: top.leapsAsk.toFixed(4),
                      leaps_units: "100",
                      leaps_contract_symbol: `${top.symbol}-C${top.leapsStrike}`,
                      updated_at: now,
                    },
                  });
                runCashUsed += debit;
                trace.pass("collateral", `screened ${top.symbol}: $${debit.toFixed(0)} debit (yield ${top.annualizedYieldPct.toFixed(0)}%/yr)`);
                trace.pass("select_contract", `${top.symbol} ${top.leapsStrike}C ${top.leapsExpiry.toISOString().slice(0, 10)} Δ~${top.leapsDelta.toFixed(2)}`);
                trace.pass("execute", `LEAPS bought via screener (real ask), debit $${debit.toFixed(2)}`);
                await db.update(ai_options_orders).set({
                  action: "open_leaps",
                  detail: {
                    screener: { picked: top.symbol, yield_pct: top.annualizedYieldPct, ranked: screenerResult.ranked.map((c) => ({ s: c.symbol, y: Math.round(c.annualizedYieldPct), d: Math.round(c.leapsDebitUsd) })), errors: screenerResult.errors },
                    strike: top.leapsStrike,
                    debit,
                    gate_trace: trace.done(),
                  },
                }).where(eq(ai_options_orders.idempotency_key, idemKey));
                outcomes.push({ underlying: top.symbol, status: "opened_long", detail: { via: "screener", forSlot: symbol, debit } });
                continue;
              }
              // Distinguish a transient empty result (market closed → $0 quotes, or
              // fetch errors) from a genuine "everything's unaffordable/illiquid"
              // decision. Transient → roll the claim back and retry next run; the
              // 07-06 dead-week bug was exactly this masquerading as terminal.
              if (isTransientScreenerResult(screenerResult)) {
                trace.halt("collateral", "screener transient (off-hours/feed) — will retry");
                await rollbackClaim(userId, idemKey);
                outcomes.push({ underlying: symbol, status: "skipped", reason: "screener transient (off-hours/feed) — will retry" });
              } else {
                trace.halt("collateral", `no affordable screened LEAPS (cash left $${cashLeft.toFixed(0)})`);
                await db.update(ai_options_orders).set({ action: "skip", detail: { reason: "no affordable screened LEAPS", screener_errors: screenerResult.errors, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
                outcomes.push({ underlying: symbol, status: "skipped", reason: "no affordable screened LEAPS" });
              }
              continue;
            }

            let leaps = selectLeaps(symbol, spot, sigma, cfg);
            // Whole-contracts: the debit must also fit in remaining cash, not just the % budget.
            if (leaps && cfg.wholeContracts && leaps.collateralUsd > availableCash - runCashUsed) leaps = null;
            if (!leaps) {
              trace.halt("collateral", `LEAPS debit > budget $${cfg.pmccBudgetUsd.toFixed(0)}`);
              await db.update(ai_options_orders).set({ action: "skip", detail: { reason: "LEAPS over budget", gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
              outcomes.push({ underlying: symbol, status: "skipped", reason: "LEAPS debit over budget" });
            } else {
              await db.insert(ai_options_positions).values({
                user_id: userId,
                underlying: symbol,
                asset_class: assetClass,
                strategy: "pmcc_leaps",
                side: "long",
                contract_symbol: leaps.contractSymbol,
                strike: leaps.strike.toFixed(4),
                expiry: leaps.expiry,
                opt_type: "C",
                contracts: 1,
                contract_multiplier: leaps.multiplier.toFixed(8),
                entry_premium: leaps.premium.toFixed(4),
                entry_spot: spot.toFixed(4),
                collateral_usd: leaps.collateralUsd.toFixed(2),
                greeks: leaps.greeks,
                council_verdict: verdict.verdict,
                council_confidence: verdict.confidence,
              });
              // Record LEAPS state so next run sells short calls against it.
              await db
                .insert(ai_options_wheel)
                .values({
                  user_id: userId,
                  underlying: symbol,
                  state: "pmcc_holding_leaps",
                  leaps_strike: leaps.strike.toFixed(4),
                  leaps_expiry: leaps.expiry,
                  leaps_net_debit: leaps.premium.toFixed(4),
                  leaps_units: leaps.multiplier.toFixed(8),
                  leaps_contract_symbol: leaps.contractSymbol,
                  updated_at: now,
                })
                .onConflictDoUpdate({
                  target: [ai_options_wheel.user_id, ai_options_wheel.underlying],
                  set: {
                    state: "pmcc_holding_leaps",
                    leaps_strike: leaps.strike.toFixed(4),
                    leaps_expiry: leaps.expiry,
                    leaps_net_debit: leaps.premium.toFixed(4),
                    leaps_units: leaps.multiplier.toFixed(8),
                    leaps_contract_symbol: leaps.contractSymbol,
                    updated_at: now,
                  },
                });
              runCashUsed += leaps.collateralUsd;
              trace.pass("collateral", `$${leaps.collateralUsd.toFixed(0)} debit`);
              trace.pass("select_contract", `${leaps.contractSymbol} Δ${leaps.greeks.delta.toFixed(2)}`);
              trace.pass("execute", `LEAPS bought, debit $${leaps.premiumTotal.toFixed(2)}`);
              await db.update(ai_options_orders).set({ action: "open_leaps", detail: { symbol: leaps.contractSymbol, strike: leaps.strike, premium: leaps.premium, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
              outcomes.push({ underlying: symbol, status: "opened_long", detail: { contractSymbol: leaps.contractSymbol, strike: leaps.strike, premiumTotal: leaps.premiumTotal } });
            }
          }
        }
      } else if (state === "cash") {
        // Skip selling puts into a strong SELL signal (don't sell puts on declining underlyings)
        if (verdict.verdict === "SELL" && verdict.confidence >= cfg.convictionThreshold) {
          trace.halt("conviction", `SELL conf ${verdict.confidence} ≥ ${cfg.convictionThreshold} — skip CSP`);
          await db.update(ai_options_orders).set({ action: "skip", detail: { reason: "SELL signal — skip CSP", verdict: verdict.verdict, confidence: verdict.confidence, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
          outcomes.push({ underlying: symbol, status: "skipped", reason: `SELL signal (conf ${verdict.confidence}) — skip CSP` });
        } else {
          trace.pass("conviction", `${verdict.verdict} ${verdict.confidence}% — ok to sell puts`);
          // Real-chain first (real bid + real liquidity — see wheel-chain.ts),
          // falls back to the BS-off-HV model on any failure (no chain, thin
          // OI, wide spread, market closed) so behavior never regresses vs
          // the pre-existing path.
          let cspSource: "live" | "real" | "model" = "model";
          let csp: LegSelection | null = null;
          let cspBrokerOrderId: string | null = null;
          let liveAttemptFailed = false;
          if (!settings.paper && assetClass !== "crypto") {
            // Live path (ai_options_settings.paper === false — no UI exposes this
            // toggle today, so this branch stays inert unless set directly in the
            // DB). Real Alpaca quote + a real order fill. Deliberately does NOT
            // fall through to the model/real(Yahoo) paths below on failure — a
            // failed live attempt must skip the underlying this cycle, never
            // silently paper-trade it under a live label.
            const liveQuote = await fetchAlpacaCSPQuote(symbol, spot, sigma, cfg, now).catch(() => null);
            if (liveQuote) {
              const multiplier = cfg.wholeContracts ? 100 : cfg.collateralPerContractUsd / liveQuote.strike;
              const collateralUsd = cfg.wholeContracts ? liveQuote.strike * 100 : cfg.collateralPerContractUsd;
              if (!(cfg.wholeContracts && collateralUsd > availableCash)) {
                const broker = new AlpacaBroker();
                const order = await broker
                  .placeOrder({ contractSymbol: liveQuote.contractSymbol, side: "sell_to_open", contracts: 1, limitPrice: liveQuote.bid })
                  .catch(() => null);
                if (order && order.status !== "filled") {
                  // Didn't fill immediately (market closed, price moved) — don't leave
                  // a resting live day-order unmanaged, clean it up before skipping.
                  await broker.cancelOrder(order.brokerOrderId).catch(() => null);
                }
                if (order && order.status === "filled" && order.filledPrice != null) {
                  csp = {
                    optType: "P",
                    strike: liveQuote.strike,
                    expiry: liveQuote.expiry,
                    dte: liveQuote.dte,
                    premium: order.filledPrice,
                    premiumTotal: order.filledPrice * multiplier,
                    greeks: liveQuote.greeks,
                    collateralUsd,
                    multiplier,
                    contractSymbol: liveQuote.contractSymbol,
                  };
                  cspSource = "live";
                  cspBrokerOrderId = order.brokerOrderId;
                }
              }
            }
            if (!csp) liveAttemptFailed = true;
          } else {
            // Real-chain, source picked by asset class: Yahoo for equity/etf
            // (unchanged), Deribit for crypto (deribit-chain.ts — only ever
            // reachable in fractional mode, whole_contracts guardrail above
            // already excludes crypto entirely when whole_contracts=true).
            const real = assetClass === "crypto"
              ? await fetchDeribitCSPQuote(symbol, spot, sigma, cfg, now).catch(() => null)
              : await fetchRealCSPQuote(symbol, spot, sigma, cfg, now).catch(() => null);
            if (real) {
              const multiplier = cfg.wholeContracts ? 100 : cfg.collateralPerContractUsd / real.strike;
              const collateralUsd = cfg.wholeContracts ? real.strike * 100 : cfg.collateralPerContractUsd;
              if (!(cfg.wholeContracts && collateralUsd > availableCash)) {
                csp = toLegSelection(symbol, "P", real, multiplier, collateralUsd);
                cspSource = "real";
              }
            }
          }
          if (!csp && !liveAttemptFailed) csp = selectCSP(symbol, spot, sigma, cfg, now, availableCash);
          if (!csp) {
            const reason = liveAttemptFailed
              ? "live execution failed — no fillable Alpaca quote, unaffordable, or order not filled"
              : "CSP unaffordable at account size";
            trace.halt("collateral", reason);
            await db.update(ai_options_orders).set({ action: "skip", detail: { reason, available_cash: availableCash, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
            outcomes.push({ underlying: symbol, status: "skipped", reason });
          } else if (openCollateral + csp.collateralUsd > maxCollateral) {
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
              broker_order_id: cspBrokerOrderId,
            });
            trace.pass("collateral", `$${csp.collateralUsd.toFixed(0)} reserved`);
            trace.pass("select_contract", `${csp.contractSymbol} Δ${csp.greeks.delta.toFixed(2)} (${cspSource === "live" ? "LIVE Alpaca fill" : cspSource === "real" ? "real chain" : "BS model"})`);
            trace.pass("execute", `CSP opened, premium $${csp.premiumTotal.toFixed(2)}`);
            await db.update(ai_options_orders).set({ action: "open_csp", detail: { symbol: csp.contractSymbol, strike: csp.strike, premium: csp.premium, source: cspSource, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
            outcomes.push({ underlying: symbol, status: "opened_csp", detail: { contractSymbol: csp.contractSymbol, strike: csp.strike, premiumTotal: csp.premiumTotal, delta: csp.greeks.delta, source: cspSource } });
          }
        }
      } else {
        // holding_stock → sell covered call against the exact held units.
        const costBasis = parseFloat(wheel?.cost_basis ?? "0");
        const heldUnits = parseFloat(wheel?.shares ?? "0");
        let ccSource: "live" | "real" | "model" = "model";
        let cc: LegSelection | null = null;
        let ccBrokerOrderId: string | null = null;
        let liveCcFailed = false;
        if (!settings.paper && assetClass !== "crypto") {
          // Live path — see the matching CSP block above for why this never
          // falls through to selectCC on failure.
          const liveQuote = await fetchAlpacaCCQuote(
            symbol, spot, costBasis, sigma, cfg, now,
            verdict.verdict as "BUY" | "HOLD" | "SELL", verdict.confidence
          ).catch(() => null);
          if (liveQuote) {
            const broker = new AlpacaBroker();
            const order = await broker
              .placeOrder({ contractSymbol: liveQuote.contractSymbol, side: "sell_to_open", contracts: 1, limitPrice: liveQuote.bid })
              .catch(() => null);
            if (order && order.status !== "filled") {
              await broker.cancelOrder(order.brokerOrderId).catch(() => null);
            }
            if (order && order.status === "filled" && order.filledPrice != null) {
              cc = {
                optType: "C",
                strike: liveQuote.strike,
                expiry: liveQuote.expiry,
                dte: liveQuote.dte,
                premium: order.filledPrice,
                premiumTotal: order.filledPrice * heldUnits,
                greeks: liveQuote.greeks,
                collateralUsd: 0,
                multiplier: heldUnits,
                contractSymbol: liveQuote.contractSymbol,
              };
              ccSource = "live";
              ccBrokerOrderId = order.brokerOrderId;
            }
          }
          if (!cc) liveCcFailed = true;
        } else {
          // Real-chain, source picked by asset class — see the matching CSP
          // block above.
          const real = assetClass === "crypto"
            ? await fetchDeribitCCQuote(
                symbol, spot, costBasis, sigma, cfg, now, undefined,
                verdict.verdict as "BUY" | "HOLD" | "SELL", verdict.confidence
              ).catch(() => null)
            : await fetchRealCCQuote(
                symbol, spot, costBasis, sigma, cfg, now, undefined,
                verdict.verdict as "BUY" | "HOLD" | "SELL", verdict.confidence
              ).catch(() => null);
          if (real) {
            cc = toLegSelection(symbol, "C", real, heldUnits, 0);
            ccSource = "real";
          }
        }
        if (!cc && !liveCcFailed) {
          cc = selectCC(
            symbol, spot, costBasis, heldUnits, sigma, cfg, now,
            verdict.verdict as "BUY" | "HOLD" | "SELL", verdict.confidence
          );
        }
        if (!cc) {
          const reason = "live execution failed — no fillable Alpaca quote or order not filled";
          trace.halt("execute", reason);
          await db.update(ai_options_orders).set({ action: "skip", detail: { reason, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
          outcomes.push({ underlying: symbol, status: "skipped", reason });
        } else {
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
            broker_order_id: ccBrokerOrderId,
          });
          trace.pass("conviction", `${verdict.verdict} ${verdict.confidence}%`);
          trace.pass("collateral", "covered by held shares");
          trace.pass("select_contract", `${cc.contractSymbol} Δ${cc.greeks.delta.toFixed(2)} (${ccSource === "live" ? "LIVE Alpaca fill" : ccSource === "real" ? "real chain" : "BS model"})`);
          trace.pass("execute", `CC opened, premium $${cc.premiumTotal.toFixed(2)}`);
          await db.update(ai_options_orders).set({ action: "open_cc", detail: { symbol: cc.contractSymbol, strike: cc.strike, premium: cc.premium, source: ccSource, gate_trace: trace.done() } }).where(eq(ai_options_orders.idempotency_key, idemKey));
          outcomes.push({ underlying: symbol, status: "opened_cc", detail: { contractSymbol: cc.contractSymbol, strike: cc.strike, premiumTotal: cc.premiumTotal, source: ccSource } });
        }
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
              // Whole-contracts mode ("live-account realism"): record the real
              // premium paid as collateral so `openCapital` (the aggregate that
              // gates CSP/LEAPS affordability against availableCash) actually
              // includes long-play spend on the NEXT run — previously long
              // plays were invisible to that aggregate regardless of mode,
              // meaning capital genuinely spent on them didn't reduce what
              // subsequent CSP/LEAPS purchases thought was available. Left at
              // "0" in fractional mode, where availableCash never gates
              // anything anyway (see selectCSP/selectLeaps' wholeContracts-
              // only affordability checks) — no behavioral difference there.
              collateral_usd: cfg.wholeContracts ? lp.premiumTotal.toFixed(2) : "0",
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
        .values({ user_id: userId, underlying: symbol, state: wheel?.state ?? (mode === "pmcc" ? "pmcc_cash" : "cash"), shares: wheel?.shares ?? "0", cost_basis: wheel?.cost_basis ?? null, next_run_at: nextRun7, updated_at: now })
        .onConflictDoUpdate({
          target: [ai_options_wheel.user_id, ai_options_wheel.underlying],
          set: { next_run_at: nextRun7, updated_at: now },
        });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      await setAlert(userId, `OPTIONS ${symbol} FAILED — ${msg}`);
      // An unhandled throw (council/network) is transient — roll the weekly claim
      // back so the underlying retries next run rather than dying for the week.
      await rollbackClaim(userId, idemKey);
      outcomes.push({ underlying: symbol, status: "failed", reason: msg });
    }
  }

  return { ran: true, outcomes };
}

// ── Daily position management ─────────────────────────────────────────────────
// PMCC income comes from actively harvesting the short leg, not riding to expiry:
//   • profit-take shorts at profit_take_pct of max profit, immediately re-short
//   • roll shorts when tested or at roll_dte
//   • settle forced early assignment (deep-ITM short calls near dividends)
//   • roll LEAPS below leaps_roll_dte (theta/gamma acceleration zone) and harvest
//     deep-ITM LEAPS so capital recycles into fresh Δ80 leverage
// No council calls — just spot + BS reprice, cheap enough to run every day.

export type ManageOutcome = {
  underlying: string;
  action: "profit_take" | "roll" | "leaps_roll" | "deep_itm_harvest" | "assigned_early" | "reshort" | "skipped" | "failed";
  detail?: Record<string, unknown>;
};

type OpenPosition = typeof ai_options_positions.$inferSelect;

export async function manageOptionsPositionsForUser(userId: string): Promise<ManageOutcome[]> {
  const settingsRows = await db
    .select()
    .from(ai_options_settings)
    .where(eq(ai_options_settings.user_id, userId))
    .limit(1);
  const settings = settingsRows[0];
  if (!settings || settings.kill_switch) return [];

  const cfg = cfgFromSettings(settings);
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const outcomes: ManageOutcome[] = [];
  const slip = cfg.slippagePct / 100;
  // Early close pays both legs' commissions (expiry settlement charges only the open).
  const closeFees = (contracts: number) => cfg.commissionPerContract * contracts * 2;

  const open = await db
    .select()
    .from(ai_options_positions)
    .where(and(eq(ai_options_positions.user_id, userId), eq(ai_options_positions.status, "open")));
  if (open.length === 0) return [];

  const wheelRows = await db
    .select()
    .from(ai_options_wheel)
    .where(eq(ai_options_wheel.user_id, userId));
  const wheelByUnderlying = new Map(wheelRows.map((r) => [r.underlying, r]));

  // One spot + sigma fetch per underlying.
  const marketCache = new Map<string, { spot: number; sigma: number }>();
  async function market(symbol: string, assetClass: string): Promise<{ spot: number; sigma: number } | null> {
    const hit = marketCache.get(symbol);
    if (hit) return hit;
    const priceData = await getPrice(symbol, assetClass).catch(() => null);
    if (!priceData?.price || priceData.price <= 0) return null;
    const series = await getPriceHistory(symbol, 30).catch(() => null);
    const sigma = histVol(series, assetClass === "crypto" ? 0.6 : 0.25);
    const entry = { spot: priceData.price, sigma };
    marketCache.set(symbol, entry);
    return entry;
  }

  // Idempotency: one order row per (position, action, day). False → already done today.
  async function claim(pos: OpenPosition, action: string, detail: Record<string, unknown>): Promise<boolean> {
    const rows = await db
      .insert(ai_options_orders)
      .values({
        user_id: userId,
        underlying: pos.underlying,
        action,
        idempotency_key: `manage:${pos.id}:${action}:${dateKey}`,
        detail,
      })
      .onConflictDoNothing({ target: ai_options_orders.idempotency_key })
      .returning({ id: ai_options_orders.id });
    return rows.length > 0;
  }

  // Close a short by buying it back at model price + slippage. Returns realized PnL.
  async function closeShort(pos: OpenPosition, current: number, exitReason: string): Promise<number> {
    const mult = parseFloat(pos.contract_multiplier) * pos.contracts;
    const fill = current * (1 + slip);
    const realized = parseFloat(pos.entry_premium) * mult - fill * mult - closeFees(pos.contracts);
    await db
      .update(ai_options_positions)
      .set({
        status: "closed",
        realized_pnl: realized.toFixed(2),
        exit_reason: exitReason,
        exit_premium: fill.toFixed(4),
        settled_at: now,
      })
      .where(eq(ai_options_positions.id, pos.id));
    return realized;
  }

  // Sell a fresh pmcc_short against the wheel's LEAPS. Returns contract symbol or null.
  async function reshort(pos: OpenPosition, spot: number, sigma: number): Promise<string | null> {
    const wheel = wheelByUnderlying.get(pos.underlying);
    if (wheel?.state !== "pmcc_holding_leaps") return null;
    const leapsStrike = parseFloat(wheel.leaps_strike ?? "0");
    const netDebit = parseFloat(wheel.leaps_net_debit ?? "0");
    const leapsUnits = parseFloat(wheel.leaps_units ?? "0");
    if (!leapsStrike || !leapsUnits) return null;
    const short = selectPmccShort(pos.underlying, spot, leapsStrike, netDebit, leapsUnits, sigma, cfg, now);
    // Floor invariant can force a strike so deep OTM the credit isn't worth the fees.
    if (short.premiumTotal <= closeFees(1)) {
      await setAlert(userId, `PMCC ${pos.underlying} — no worthwhile short credit above floor, staying uncovered`);
      return null;
    }
    await db.insert(ai_options_positions).values({
      user_id: userId,
      underlying: pos.underlying,
      asset_class: pos.asset_class,
      strategy: "pmcc_short",
      side: "short",
      contract_symbol: short.contractSymbol,
      strike: short.strike.toFixed(4),
      expiry: short.expiry,
      opt_type: "C",
      contracts: 1,
      contract_multiplier: short.multiplier.toFixed(8),
      entry_premium: short.premium.toFixed(4),
      entry_spot: spot.toFixed(4),
      collateral_usd: "0",
      greeks: short.greeks,
    });
    return short.contractSymbol;
  }

  const leapsPositions = open.filter((p) => p.strategy === "pmcc_leaps");
  const shortPositions = open.filter((p) => ["csp", "cc", "pmcc_short"].includes(p.strategy));
  // Underlyings whose LEAPS closed this run — their shorts are handled here, skip below.
  const leapsClosedFor = new Set<string>();

  // ── LEAPS lifecycle first: a roll/harvest closes the whole diagonal ─────────
  for (const pos of leapsPositions) {
    try {
      const t = yearsTo(pos.expiry, now);
      const dte = Math.round((pos.expiry.getTime() - now.getTime()) / 86_400_000);
      if (dte <= 0) continue; // expiry settlement in the weekly run owns this
      const mkt = await market(pos.underlying, pos.asset_class);
      if (!mkt) continue;
      const strike = parseFloat(pos.strike);
      const mult = parseFloat(pos.contract_multiplier) * pos.contracts;
      const entry = parseFloat(pos.entry_premium);
      const current = bsPrice({ type: "C", S: mkt.spot, K: strike, t, r: cfg.riskFreeRate, sigma: mkt.sigma });
      const greeks = bsGreeks({ type: "C", S: mkt.spot, K: strike, t, r: cfg.riskFreeRate, sigma: mkt.sigma });
      const unrealized = (current - entry) * mult;

      const shouldRoll = dte <= settings.leaps_roll_dte;
      const shouldHarvest = greeks.delta >= 0.95 && unrealized >= 0.5 * entry * mult;
      if (!shouldRoll && !shouldHarvest) continue;

      const exitReason = shouldRoll ? "leaps_roll" : "deep_itm_harvest";
      if (!(await claim(pos, exitReason, { dte, delta: greeks.delta, unrealized }))) continue;

      // Close the accompanying short first — the diagonal unwinds as a unit.
      const shortPos = shortPositions.find(
        (p) => p.underlying === pos.underlying && p.strategy === "pmcc_short"
      );
      if (shortPos) {
        const ts = yearsTo(shortPos.expiry, now);
        const shortCur = bsPrice({
          type: "C", S: mkt.spot, K: parseFloat(shortPos.strike), t: ts, r: cfg.riskFreeRate, sigma: mkt.sigma,
        });
        await closeShort(shortPos, shortCur, exitReason);
      }

      // Sell the LEAPS at model price − slippage.
      const fill = current * (1 - slip);
      const realized = fill * mult - entry * mult - closeFees(pos.contracts);
      await db
        .update(ai_options_positions)
        .set({
          status: "closed",
          realized_pnl: realized.toFixed(2),
          exit_reason: exitReason,
          exit_premium: fill.toFixed(4),
          settled_at: now,
        })
        .where(eq(ai_options_positions.id, pos.id));

      // Reset the wheel — next weekly run buys a fresh Δ80 LEAPS (via screener when enabled).
      await db
        .update(ai_options_wheel)
        .set({
          state: "pmcc_cash",
          leaps_strike: null,
          leaps_expiry: null,
          leaps_net_debit: null,
          leaps_units: null,
          leaps_contract_symbol: null,
          updated_at: now,
        })
        .where(and(eq(ai_options_wheel.user_id, userId), eq(ai_options_wheel.underlying, pos.underlying)));

      leapsClosedFor.add(pos.underlying);
      outcomes.push({
        underlying: pos.underlying,
        action: exitReason as ManageOutcome["action"],
        detail: { dte, delta: greeks.delta, realized, closedShort: shortPos?.contract_symbol ?? null },
      });
    } catch (err) {
      outcomes.push({ underlying: pos.underlying, action: "failed", detail: { error: err instanceof Error ? err.message : "unknown" } });
    }
  }

  // ── Short-leg management: assignment check → profit take → roll ─────────────
  for (const pos of shortPositions) {
    if (leapsClosedFor.has(pos.underlying)) continue;
    try {
      const t = yearsTo(pos.expiry, now);
      const dte = Math.round((pos.expiry.getTime() - now.getTime()) / 86_400_000);
      if (dte <= 0) continue; // expiry settlement owns it
      const mkt = await market(pos.underlying, pos.asset_class);
      if (!mkt) continue;
      const strike = parseFloat(pos.strike);
      const entry = parseFloat(pos.entry_premium);
      const optType = pos.opt_type as OptType;
      const current = bsPrice({ type: optType, S: mkt.spot, K: strike, t, r: cfg.riskFreeRate, sigma: mkt.sigma });

      // 1. Early assignment: deep-ITM short call with no extrinsic left, near a
      //    quarterly dividend month. Forced, not chosen — check first.
      //
      // Threshold scales with spot (0.1% of spot), not a flat $0.05 — under
      // Black-Scholes, an ITM call's extrinsic value has a hard floor of
      // roughly strike × riskFreeRate × yearsToExpiry from interest-rate time
      // value ALONE, independent of vol. For a $500 strike at 10 DTE that
      // floor is already ≈$0.55 — a flat $0.05 threshold made this branch
      // essentially unreachable for any strike above ~$50 at any DTE beyond
      // ~1 day (found via engine.test.ts trying to exercise it, 2026-07-15).
      const isDivMonth = [3, 6, 9, 12].includes(now.getUTCMonth() + 1);
      const intrinsic = optType === "C" ? Math.max(0, mkt.spot - strike) : Math.max(0, strike - mkt.spot);
      const extrinsic = Math.max(0, current - intrinsic);
      const extrinsicFloor = mkt.spot * 0.001;
      if (
        optType === "C" &&
        pos.asset_class !== "crypto" &&
        isDivMonth &&
        intrinsic > 0 &&
        extrinsic < extrinsicFloor
      ) {
        if (!(await claim(pos, "assigned_early", { spot: mkt.spot, extrinsic }))) continue;
        const wheel = wheelByUnderlying.get(pos.underlying);
        const result = settle(
          pos.strategy as "cc" | "pmcc_short",
          strike,
          entry,
          mkt.spot,
          pos.contracts,
          parseFloat(pos.contract_multiplier),
          wheel?.cost_basis != null ? parseFloat(wheel.cost_basis) : undefined,
          cfg.wholeContracts ? cfg.commissionPerContract * pos.contracts : 0
        );
        await db
          .update(ai_options_positions)
          .set({
            status: result.status,
            realized_pnl: result.realizedPnl.toFixed(2),
            exit_reason: "assigned_early",
            settled_at: now,
          })
          .where(eq(ai_options_positions.id, pos.id));
        if (pos.strategy === "cc") {
          await db
            .update(ai_options_wheel)
            .set({ state: "cash", shares: "0", cost_basis: null, updated_at: now })
            .where(and(eq(ai_options_wheel.user_id, userId), eq(ai_options_wheel.underlying, pos.underlying)));
        }
        outcomes.push({ underlying: pos.underlying, action: "assigned_early", detail: { pnl: result.realizedPnl } });
        continue;
      }

      // 2. Profit take: buy back once profit_take_pct of max profit is captured,
      //    then immediately re-short (pmcc_short only — the compounding engine).
      if (current <= entry * (1 - cfg.profitTakePct / 100)) {
        if (!(await claim(pos, "profit_take", { entry, current, dte }))) continue;
        const realized = await closeShort(pos, current, "profit_take");
        outcomes.push({ underlying: pos.underlying, action: "profit_take", detail: { realized, dte } });
        if (pos.strategy === "pmcc_short") {
          const sym = await reshort(pos, mkt.spot, mkt.sigma);
          if (sym) outcomes.push({ underlying: pos.underlying, action: "reshort", detail: { contractSymbol: sym } });
        }
        continue;
      }

      // 3. Roll: tested (spot through the strike) or inside the gamma window.
      const tested = optType === "C" ? mkt.spot > strike : mkt.spot < strike;
      if (tested || dte <= cfg.rollDte) {
        if (!(await claim(pos, "roll", { tested, dte, spot: mkt.spot, strike }))) continue;
        const realized = await closeShort(pos, current, "roll");
        outcomes.push({ underlying: pos.underlying, action: "roll", detail: { realized, tested, dte } });
        if (pos.strategy === "pmcc_short") {
          const sym = await reshort(pos, mkt.spot, mkt.sigma);
          if (sym) outcomes.push({ underlying: pos.underlying, action: "reshort", detail: { contractSymbol: sym } });
        }
        // csp/cc: close only — the weekly run re-enters through the state machine.
      }
    } catch (err) {
      outcomes.push({ underlying: pos.underlying, action: "failed", detail: { error: err instanceof Error ? err.message : "unknown" } });
    }
  }

  // ── Cover uncovered LEAPS ────────────────────────────────────────────────────
  // A LEAPS with no live short call is idle leverage — e.g. a screener buy from the
  // weekly run, or a short that closed without a same-run replacement. Sell one.
  const coveredNow = new Set(
    (await db
      .select({ underlying: ai_options_positions.underlying })
      .from(ai_options_positions)
      .where(
        and(
          eq(ai_options_positions.user_id, userId),
          eq(ai_options_positions.status, "open"),
          eq(ai_options_positions.strategy, "pmcc_short")
        )
      )).map((r) => r.underlying)
  );
  for (const wheel of wheelRows) {
    if (wheel.state !== "pmcc_holding_leaps" || coveredNow.has(wheel.underlying)) continue;
    if (leapsClosedFor.has(wheel.underlying)) continue;
    try {
      const assetClass = isCryptoUnderlying(wheel.underlying) ? "crypto" : "equity";
      if (cfg.wholeContracts && assetClass === "crypto") continue;
      const mkt = await market(wheel.underlying, assetClass);
      if (!mkt) continue;
      const leapsStrike = parseFloat(wheel.leaps_strike ?? "0");
      const netDebit = parseFloat(wheel.leaps_net_debit ?? "0");
      const leapsUnits = parseFloat(wheel.leaps_units ?? "0");
      if (!leapsStrike || !leapsUnits) continue;
      // Per-underlying-per-day idempotency for the cover action.
      const rows = await db
        .insert(ai_options_orders)
        .values({
          user_id: userId,
          underlying: wheel.underlying,
          action: "open_pmcc_short",
          idempotency_key: `manage:cover:${wheel.underlying}:${dateKey}`,
          detail: {},
        })
        .onConflictDoNothing({ target: ai_options_orders.idempotency_key })
        .returning({ id: ai_options_orders.id });
      if (rows.length === 0) continue;
      const short = selectPmccShort(wheel.underlying, mkt.spot, leapsStrike, netDebit, leapsUnits, mkt.sigma, cfg, now);
      if (short.premiumTotal <= closeFees(1)) {
        await setAlert(userId, `PMCC ${wheel.underlying} — no worthwhile short credit above floor, staying uncovered`);
        continue;
      }
      await db.insert(ai_options_positions).values({
        user_id: userId,
        underlying: wheel.underlying,
        asset_class: assetClass,
        strategy: "pmcc_short",
        side: "short",
        contract_symbol: short.contractSymbol,
        strike: short.strike.toFixed(4),
        expiry: short.expiry,
        opt_type: "C",
        contracts: 1,
        contract_multiplier: short.multiplier.toFixed(8),
        entry_premium: short.premium.toFixed(4),
        entry_spot: mkt.spot.toFixed(4),
        collateral_usd: "0",
        greeks: short.greeks,
      });
      await db
        .update(ai_options_orders)
        .set({ detail: { symbol: short.contractSymbol, strike: short.strike, premium: short.premium, via: "cover_uncovered_leaps" } })
        .where(eq(ai_options_orders.idempotency_key, `manage:cover:${wheel.underlying}:${dateKey}`));
      outcomes.push({ underlying: wheel.underlying, action: "reshort", detail: { contractSymbol: short.contractSymbol, via: "cover" } });
    } catch (err) {
      outcomes.push({ underlying: wheel.underlying, action: "failed", detail: { error: err instanceof Error ? err.message : "unknown" } });
    }
  }

  return outcomes;
}
