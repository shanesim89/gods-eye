import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import {
  ai_token_schedule,
  ai_trade_orders,
  council_verdict_cache,
  assets,
} from "@/db/schema";
import { getOrCreateSettings } from "@/lib/trading/settings";
import { getPrice, getPriceHistory } from "@/lib/market";
import { evaluateBuyZone, orderAmountUsd } from "@/lib/trading/buy-zone";
import type { Verdict } from "@/lib/council/types";
import { KillSwitch as KillSwitchClient } from "./KillSwitch";
import { HudCard, type TokenRow } from "./HudCard";
import { PortfolioSummary, type AllocSlice } from "./PortfolioSummary";
import { StrategyThesis, type TokenThesis } from "./StrategyThesis";
import { OrderLog, type OrderRow } from "./OrderLog";
import { CouncilReasoning } from "./CouncilReasoning";

export const dynamic = "force-dynamic";

const TOKENS = ["BTC", "ETH", "SOL", "HYPE"] as const;

function usd(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

export default async function CryptoDashboard() {
  const user = await requireUser();
  const settings = await getOrCreateSettings(user.id);

  const dca = parseFloat(settings.dca_amount_usd);
  const boost = parseFloat(settings.boost_amount_usd);
  const cap = parseFloat(settings.monthly_cap_usd);
  const minConf = settings.buy_zone_confidence;
  const sellSkipThreshold = (settings.sell_skip_threshold as number | null) ?? 70;
  const maxConsecutiveSkips = (settings.max_consecutive_skips as number | null) ?? 1;
  const overrides = (settings.token_overrides as Record<string, { max_price?: number; cadence_days?: number }>) ?? {};

  // Month-to-date spend
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const spentRows = await db
    .select({ total: sql<string>`coalesce(sum(${ai_trade_orders.usd_amount}), 0)` })
    .from(ai_trade_orders)
    .where(and(eq(ai_trade_orders.user_id, user.id), eq(ai_trade_orders.status, "filled"), gte(ai_trade_orders.created_at, monthStart)));
  const spent = parseFloat(spentRows[0]?.total ?? "0");

  // Schedules
  const schedRows = await db.select().from(ai_token_schedule).where(eq(ai_token_schedule.user_id, user.id));
  const schedByToken = new Map(schedRows.map((r) => [r.token, r]));

  // Holdings with cost_basis
  const holdingRows = await db
    .select({ ticker: assets.ticker, qty: assets.qty, costBasis: assets.cost_basis })
    .from(assets)
    .where(and(eq(assets.user_id, user.id), eq(assets.asset_class, "crypto")));

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

  // Fill counts + last order per token
  const allOrders = await db
    .select()
    .from(ai_trade_orders)
    .where(eq(ai_trade_orders.user_id, user.id))
    .orderBy(desc(ai_trade_orders.created_at));

  const fillCountByToken = new Map<string, number>();
  const lastOrderByToken = new Map<string, typeof allOrders[0]>();
  for (const o of allOrders) {
    if (!lastOrderByToken.has(o.token)) lastOrderByToken.set(o.token, o);
    if (o.status === "filled") fillCountByToken.set(o.token, (fillCountByToken.get(o.token) ?? 0) + 1);
  }

  // Per-token data
  const rows = await Promise.all(
    TOKENS.map(async (token): Promise<TokenRow> => {
      const [priceData, verdictRow, spark] = await Promise.all([
        getPrice(token, "crypto").catch(() => null),
        db
          .select()
          .from(council_verdict_cache)
          .where(and(
            eq(council_verdict_cache.user_id, user.id),
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
        nextRun: sched?.next_run_at ?? null,
        qty: holding.qty,
        costBasis: holding.costBasis > 0 ? holding.costBasis : null,
        maxPrice: overrides[token]?.max_price ?? null,
        fillCount: fillCountByToken.get(token) ?? 0,
        lastOrder: lastO
          ? {
              date: lastO.created_at,
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

  const spentPct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;

  // Portfolio totals + allocation
  const tokenValues = rows.map((r) => ({
    token: r.token,
    value: r.qty > 0 && r.price ? r.qty * r.price : 0,
    costBasis: r.costBasis ?? 0,
  }));
  const totalValue = tokenValues.reduce((s, t) => s + t.value, 0);
  const totalCost = tokenValues.reduce((s, t) => s + t.costBasis, 0);
  const totalPnl = totalValue > 0 ? totalValue - totalCost : null;
  const totalPnlPct = totalPnl != null && totalCost > 0 ? (totalPnl / totalCost) * 100 : null;
  const alloc: AllocSlice[] = tokenValues.map((t) => ({
    token: t.token,
    value: t.value,
    pct: totalValue > 0 ? t.value / totalValue : 0,
  }));

  // Per-token entry thesis for the strategy panel
  const thesis: TokenThesis[] = rows.map((r) => ({
    token: r.token,
    maxPrice: r.maxPrice,
    cadenceDays: overrides[r.token]?.cadence_days ?? 14,
    price: r.price,
  }));

  // Per-token breakdown for the alternative "total position" table view
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

  // Per-token council reasoning for the toggle panel
  const reasoning = rows.map((r) => ({ token: r.token, verdict: r.verdict, price: r.price }));

  // Full order log (most recent first; allOrders already desc by created_at)
  const orderLog: OrderRow[] = allOrders.map((o) => ({
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
  }));

  return (
    <Panel title="AI PORTFOLIO · CRYPTO" meta="DCA + COUNCIL BUY-ZONE">
      {/* top control bar */}
      <div className="flex flex-wrap items-center gap-4 mb-4 border border-border bg-grid p-3">
        <div className="flex items-center gap-2">
          <span className="text-muted text-[10px] uppercase tracking-[1px]">STATUS</span>
          <KillSwitchClient initialKillSwitch={settings.kill_switch} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex justify-between text-[10px] uppercase tracking-[1px] mb-1">
            <span className="text-muted">MONTH SPEND</span>
            <span className="text-amber tabular-nums">{usd(spent)} / {usd(cap)}</span>
          </div>
          <div className="h-1.5 bg-black border border-border">
            <div className={`h-full ${spentPct >= 100 ? "bg-red" : "bg-amber"}`} style={{ width: `${spentPct}%` }} />
          </div>
        </div>
        <div className="text-[10px] text-dim uppercase tracking-[1px]">
          DCA {usd(dca, 0)} · BOOST {usd(boost, 0)} · MIN CONF {minConf}%
        </div>
      </div>

      {settings.last_alert && (
        <div className="border border-red/60 bg-red/5 text-red px-3 py-1.5 mb-4 text-[10px] tracking-[0.5px]">
          ⚠ {settings.last_alert}
        </div>
      )}

      <style>{`
        @keyframes blip{0%,100%{opacity:1}50%{opacity:.2}}
        .live-blip{animation:blip 1.4s ease-in-out infinite}
      `}</style>

      {/* strategy thesis + how-it-decides */}
      <StrategyThesis
        dca={dca}
        boost={boost}
        cap={cap}
        minConf={minConf}
        sellSkipThreshold={sellSkipThreshold}
        maxConsecutiveSkips={maxConsecutiveSkips}
        tokens={thesis}
      />

      {/* overall position dashboard — toggle allocation ↔ breakdown */}
      <PortfolioSummary
        totalValue={totalValue}
        totalCost={totalCost}
        totalPnl={totalPnl}
        totalPnlPct={totalPnlPct}
        alloc={alloc}
        breakdown={breakdown}
      />

      {/* per-coin council reasoning toggle */}
      <CouncilReasoning entries={reasoning} />

      {/* 4-across compact cards (reflows to 2×2 on narrow screens) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {rows.map((row) => (
          <HudCard key={row.token} row={row} />
        ))}
      </div>

      {/* per-buy order history */}
      <OrderLog orders={orderLog} />
    </Panel>
  );
}
