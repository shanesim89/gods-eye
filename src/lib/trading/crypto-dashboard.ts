import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_token_schedule, ai_trade_orders, council_verdict_cache, assets } from "@/db/schema";
import { getOrCreateSettings } from "@/lib/trading/settings";
import { getPrice, getPriceHistory, getPriceOHLC, type OhlcBar } from "@/lib/market";
import { evaluateBuyZone, orderAmountUsd } from "@/lib/trading/buy-zone";
import type { Verdict } from "@/lib/council/types";
import { parseGateTrace } from "@/lib/trading/gates";

const TOKENS = ["BTC", "ETH", "SOL", "HYPE"] as const;

/** Wire-safe (JSON) version of crypto/HudCard's TokenRow — nextRun/lastOrder.date as ISO strings. */
export type WireTokenRow = {
  token: string;
  price: number | null;
  changePct: number | null;
  verdict: Verdict | null;
  bz: ReturnType<typeof evaluateBuyZone>;
  plannedAmount: number;
  boosted: boolean;
  nextRun: string | null;
  qty: number;
  costBasis: number | null;
  maxPrice: number | null;
  fillCount: number;
  lastOrder: { date: string; amount: number; status: string; price: number | null } | null;
  spark: number[];
  consecutiveSkips: number;
  sellSkipThreshold: number;
  maxConsecutiveSkips: number;
};

export type CryptoDashboardData = {
  killSwitch: boolean;
  lastAlert: string | null;
  dca: number;
  boost: number;
  cap: number;
  minConf: number;
  spent: number;
  rows: WireTokenRow[];
  totalValue: number;
  totalCost: number;
  totalPnl: number | null;
  totalPnlPct: number | null;
  alloc: { token: string; value: number; pct: number }[];
  breakdown: {
    token: string; qty: number; price: number | null; value: number; cost: number;
    pnl: number | null; pnlPct: number | null; pct: number;
  }[];
  thesis: { token: string; maxPrice: number | null; cadenceDays: number; price: number | null }[];
  reasoning: { token: string; verdict: Verdict | null; price: number | null; qty: number; costBasis: number | null }[];
  orderLog: {
    id: string; token: string; date: string; status: string; usdAmount: number; qty: number | null;
    price: number | null; boosted: boolean; verdict: string | null; confidence: number | null;
    dipDepthPct: number | null; error: string | null; exchangeOrderId: string | null;
    gateTrace: ReturnType<typeof parseGateTrace>;
  }[];
  planRows: {
    token: string; nextRunAt: string | null; plannedUsd: number; boostUsd: number;
    consecutiveSkips: number; maxSkips: number; maxPrice: number | null; price: number | null;
  }[];
  planByToken: Record<string, { nextRunAt: string | null; plannedUsd: number; boostUsd: number; consecutiveSkips: number; maxSkips: number }>;
  candles: Record<string, OhlcBar[]>;
  sellSkipThreshold: number;
  maxConsecutiveSkips: number;
};

export async function getCryptoDashboardData(userId: string): Promise<CryptoDashboardData> {
  const settings = await getOrCreateSettings(userId);

  const dca = parseFloat(settings.dca_amount_usd);
  const boost = parseFloat(settings.boost_amount_usd);
  const cap = parseFloat(settings.monthly_cap_usd);
  const minConf = settings.buy_zone_confidence;
  const sellSkipThreshold = (settings.sell_skip_threshold as number | null) ?? 70;
  const maxConsecutiveSkips = (settings.max_consecutive_skips as number | null) ?? 1;
  const overrides = (settings.token_overrides as Record<string, { max_price?: number; cadence_days?: number }>) ?? {};

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const spentRows = await db
    .select({ total: sql<string>`coalesce(sum(${ai_trade_orders.usd_amount}), 0)` })
    .from(ai_trade_orders)
    .where(and(eq(ai_trade_orders.user_id, userId), eq(ai_trade_orders.status, "filled"), gte(ai_trade_orders.created_at, monthStart)));
  const spent = parseFloat(spentRows[0]?.total ?? "0");

  const schedRows = await db.select().from(ai_token_schedule).where(eq(ai_token_schedule.user_id, userId));
  const schedByToken = new Map(schedRows.map((r) => [r.token, r]));

  const holdingRows = await db
    .select({ ticker: assets.ticker, qty: assets.qty, costBasis: assets.cost_basis })
    .from(assets)
    .where(and(eq(assets.user_id, userId), eq(assets.asset_class, "crypto")));

  const holdingByToken = new Map<string, { qty: number; costBasis: number }>();
  for (const h of holdingRows) {
    if (!h.ticker) continue;
    const t = h.ticker.toUpperCase();
    const prev = holdingByToken.get(t) ?? { qty: 0, costBasis: 0 };
    holdingByToken.set(t, {
      qty: prev.qty + (h.qty ? parseFloat(h.qty) : 0),
      costBasis: prev.costBasis + (h.costBasis ? parseFloat(h.costBasis) : 0),
    });
  }

  const allOrders = await db
    .select()
    .from(ai_trade_orders)
    .where(eq(ai_trade_orders.user_id, userId))
    .orderBy(desc(ai_trade_orders.created_at));

  const fillCountByToken = new Map<string, number>();
  const lastOrderByToken = new Map<string, (typeof allOrders)[0]>();
  for (const o of allOrders) {
    if (!lastOrderByToken.has(o.token)) lastOrderByToken.set(o.token, o);
    if (o.status === "filled") fillCountByToken.set(o.token, (fillCountByToken.get(o.token) ?? 0) + 1);
  }

  const rows = await Promise.all(
    TOKENS.map(async (token): Promise<WireTokenRow> => {
      const [priceData, verdictRow, spark] = await Promise.all([
        getPrice(token, "crypto").catch(() => null),
        db
          .select()
          .from(council_verdict_cache)
          .where(and(
            eq(council_verdict_cache.user_id, userId),
            eq(council_verdict_cache.ticker, token),
            eq(council_verdict_cache.asset_class, "crypto")
          ))
          .orderBy(desc(council_verdict_cache.fetched_at))
          .limit(1)
          .then((r) => r[0] ?? null),
        getPriceHistory(token, 30).catch(() => null),
      ]);

      let verdict: Verdict | null = null;
      if (verdictRow) {
        const p = verdictRow.payload as Partial<Verdict>;
        verdict = {
          verdict: verdictRow.verdict as Verdict["verdict"],
          confidence: verdictRow.confidence ?? 50,
          summary: p.summary ?? "",
          agents: p.agents ?? [],
          generatedAt: verdictRow.fetched_at.toISOString(),
          tradeLevels: p.tradeLevels ?? null,
          currency: p.currency ?? "USD",
          laymanExplanation: p.laymanExplanation ?? null,
        };
      }

      const price = priceData?.price ?? null;
      const bz = evaluateBuyZone(verdict, price ?? 0, minConf);
      const { amount, boosted } = orderAmountUsd(bz.isBuyZone, dca, boost);
      const holding = holdingByToken.get(token) ?? { qty: 0, costBasis: 0 };
      const lastO = lastOrderByToken.get(token);
      const sched = schedByToken.get(token);

      return {
        token,
        price,
        changePct: priceData?.change_pct ?? null,
        verdict,
        bz,
        plannedAmount: amount,
        boosted,
        nextRun: sched?.next_run_at ? sched.next_run_at.toISOString() : null,
        qty: holding.qty,
        costBasis: holding.costBasis > 0 ? holding.costBasis : null,
        maxPrice: overrides[token]?.max_price ?? null,
        fillCount: fillCountByToken.get(token) ?? 0,
        lastOrder: lastO
          ? {
              date: lastO.created_at.toISOString(),
              amount: parseFloat(lastO.usd_amount),
              status: lastO.status,
              price: lastO.price ? parseFloat(lastO.price) : null,
            }
          : null,
        spark: spark ?? [],
        consecutiveSkips: sched?.consecutive_skips ?? 0,
        sellSkipThreshold,
        maxConsecutiveSkips,
      };
    })
  );

  const candlesByToken: Record<string, OhlcBar[]> = {};
  await Promise.all(
    TOKENS.map(async (token) => {
      candlesByToken[token] = (await getPriceOHLC(token, 90).catch(() => null)) ?? [];
    })
  );

  const tokenValues = rows.map((r) => ({
    token: r.token,
    value: r.qty > 0 && r.price ? r.qty * r.price : 0,
    costBasis: r.costBasis ?? 0,
  }));
  const totalValue = tokenValues.reduce((s, t) => s + t.value, 0);
  const totalCost = tokenValues.reduce((s, t) => s + t.costBasis, 0);
  const totalPnl = totalValue > 0 ? totalValue - totalCost : null;
  const totalPnlPct = totalPnl != null && totalCost > 0 ? (totalPnl / totalCost) * 100 : null;
  const alloc = tokenValues.map((t) => ({
    token: t.token,
    value: t.value,
    pct: totalValue > 0 ? t.value / totalValue : 0,
  }));

  const thesis = rows.map((r) => ({
    token: r.token,
    maxPrice: r.maxPrice,
    cadenceDays: overrides[r.token]?.cadence_days ?? 14,
    price: r.price,
  }));

  const breakdown = rows.map((r) => {
    const value = r.qty > 0 && r.price ? r.qty * r.price : 0;
    const cost = r.costBasis ?? 0;
    const pnl = value > 0 ? value - cost : null;
    return {
      token: r.token,
      qty: r.qty,
      price: r.price,
      value,
      cost,
      pnl,
      pnlPct: pnl != null && cost > 0 ? (pnl / cost) * 100 : null,
      pct: totalValue > 0 ? value / totalValue : 0,
    };
  });

  const reasoning = rows.map((r) => ({
    token: r.token,
    verdict: r.verdict,
    price: r.price,
    qty: r.qty,
    costBasis: r.costBasis,
  }));

  const orderLog = allOrders.map((o) => ({
    id: o.id,
    token: o.token,
    date: o.created_at.toISOString(),
    status: o.status,
    usdAmount: parseFloat(o.usd_amount),
    qty: o.qty ? parseFloat(o.qty) : null,
    price: o.price ? parseFloat(o.price) : null,
    boosted: o.boosted,
    verdict: o.council_verdict,
    confidence: o.council_confidence,
    dipDepthPct: o.dip_depth_pct ? parseFloat(o.dip_depth_pct) : null,
    error: o.error,
    exchangeOrderId: o.exchange_order_id,
    gateTrace: parseGateTrace(o.gate_trace),
  }));

  const planRows = rows.map((r) => ({
    token: r.token,
    nextRunAt: r.nextRun,
    plannedUsd: dca,
    boostUsd: boost,
    consecutiveSkips: r.consecutiveSkips,
    maxSkips: maxConsecutiveSkips,
    maxPrice: r.maxPrice,
    price: r.price,
  }));
  const planByToken: CryptoDashboardData["planByToken"] = Object.fromEntries(
    planRows.map((p) => [p.token, {
      nextRunAt: p.nextRunAt,
      plannedUsd: p.plannedUsd,
      boostUsd: p.boostUsd,
      consecutiveSkips: p.consecutiveSkips,
      maxSkips: p.maxSkips,
    }])
  );

  return {
    killSwitch: settings.kill_switch,
    lastAlert: settings.last_alert,
    dca, boost, cap, minConf, spent,
    rows, totalValue, totalCost, totalPnl, totalPnlPct, alloc, breakdown,
    thesis, reasoning, orderLog, planRows, planByToken,
    candles: candlesByToken,
    sellSkipThreshold, maxConsecutiveSkips,
  };
}
