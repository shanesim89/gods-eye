import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_trade_orders, assets } from "@/db/schema";
import { getOrCreateSettings } from "@/lib/trading/settings";
import { getPrice, getPriceHistory, getPriceOHLC, type OhlcBar } from "@/lib/market";
import { parseGateTrace } from "@/lib/trading/gates";

const TOKENS = ["BTC", "ETH", "SOL", "HYPE"] as const;
const BUY_USD = 50;
const DROP_TRIGGER_PCT = 8;

/** Wire-safe (JSON) version of crypto/HudCard's TokenRow — lastOrder.date as ISO string. */
export type WireTokenRow = {
  token: string;
  price: number | null;
  changePct: number | null;
  high7d: number | null;
  dropPct: number | null; // % below 7d high; 0 or negative = at/above high
  armed: boolean; // dropPct >= 8
  qty: number;
  costBasis: number | null;
  fillCount: number;
  lastOrder: { date: string; amount: number; status: string; price: number | null } | null;
  spark: number[];
};

export type CryptoDashboardData = {
  killSwitch: boolean;
  lastAlert: string | null;
  buyUsd: number;
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
  orderLog: {
    id: string; token: string; date: string; status: string; usdAmount: number; qty: number | null;
    price: number | null; error: string | null; exchangeOrderId: string | null;
    gateTrace: ReturnType<typeof parseGateTrace>;
  }[];
  candles: Record<string, OhlcBar[]>;
};

export async function getCryptoDashboardData(userId: string): Promise<CryptoDashboardData> {
  const settings = await getOrCreateSettings(userId);

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const spentRows = await db
    .select({ total: sql<string>`coalesce(sum(${ai_trade_orders.usd_amount}), 0)` })
    .from(ai_trade_orders)
    .where(and(eq(ai_trade_orders.user_id, userId), eq(ai_trade_orders.status, "filled"), gte(ai_trade_orders.created_at, monthStart)));
  const spent = parseFloat(spentRows[0]?.total ?? "0");

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
      const [priceData, history, spark] = await Promise.all([
        getPrice(token, "crypto").catch(() => null),
        getPriceHistory(token, 7).catch(() => null),
        getPriceHistory(token, 30).catch(() => null),
      ]);

      const price = priceData?.price ?? null;
      const high7d = history && history.length > 0 && price != null ? Math.max(...history, price) : null;
      const dropPct = high7d != null && price != null ? ((high7d - price) / high7d) * 100 : null;
      const holding = holdingByToken.get(token) ?? { qty: 0, costBasis: 0 };
      const lastO = lastOrderByToken.get(token);

      return {
        token,
        price,
        changePct: priceData?.change_pct ?? null,
        high7d,
        dropPct,
        armed: dropPct != null && dropPct >= DROP_TRIGGER_PCT,
        qty: holding.qty,
        costBasis: holding.costBasis > 0 ? holding.costBasis : null,
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

  const orderLog = allOrders.map((o) => ({
    id: o.id,
    token: o.token,
    date: o.created_at.toISOString(),
    status: o.status,
    usdAmount: parseFloat(o.usd_amount),
    qty: o.qty ? parseFloat(o.qty) : null,
    price: o.price ? parseFloat(o.price) : null,
    error: o.error,
    exchangeOrderId: o.exchange_order_id,
    gateTrace: parseGateTrace(o.gate_trace),
  }));

  return {
    killSwitch: settings.kill_switch,
    lastAlert: settings.last_alert,
    buyUsd: BUY_USD,
    spent,
    rows, totalValue, totalCost, totalPnl, totalPnlPct, alloc, breakdown,
    orderLog,
    candles: candlesByToken,
  };
}
