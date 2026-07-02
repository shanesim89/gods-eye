import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  assets,
  ai_trade_orders,
  ai_trading_settings,
  ai_options_positions,
  market_data_cache,
} from "@/db/schema";
import { getPrice } from "@/lib/market";

type QuantState = {
  equity: number;
  starting_balance: number;
  circuit_state?: string;
  regime?: string;
  sleeve_weights?: Record<string, number>;
  backtest_stats?: { oos_sharpe: number };
  history?: { date: string; equity: number }[];
};

type DipCoin = { symbol: string; bounce_score: number };

const TOKENS = ["BTC", "ETH", "SOL", "HYPE"] as const;

function usd(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function pnlStr(value: number, cost: number): string {
  const p = value - cost;
  const pct = cost > 0 ? (p / cost) * 100 : 0;
  const sign = p >= 0 ? "+" : "-";
  return `${sign}${usd(Math.abs(p))} (${sign}${Math.abs(pct).toFixed(1)}%)`;
}

export async function buildPortfolioDigest(userId: string): Promise<string | null> {
  try {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    });
    const lines: string[] = [];

    lines.push(`📊 PORTFOLIO UPDATES — ${dateStr}`);
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // ── Crypto DCA (Live) ────────────────────────────────────────────────────
    const holdingRows = await db
      .select({ ticker: assets.ticker, qty: assets.qty, costBasis: assets.cost_basis })
      .from(assets)
      .where(and(eq(assets.user_id, userId), eq(assets.asset_class, "crypto")));

    const holdingMap = new Map<string, { qty: number; cost: number }>();
    for (const h of holdingRows) {
      if (!h.ticker) continue;
      const t = h.ticker.toUpperCase();
      const prev = holdingMap.get(t) ?? { qty: 0, cost: 0 };
      holdingMap.set(t, {
        qty: prev.qty + parseFloat(h.qty ?? "0"),
        cost: prev.cost + parseFloat(h.costBasis ?? "0"),
      });
    }

    const settingsRow = await db
      .select({ monthly_cap_usd: ai_trading_settings.monthly_cap_usd })
      .from(ai_trading_settings)
      .where(eq(ai_trading_settings.user_id, userId))
      .limit(1);
    const cap = parseFloat(settingsRow[0]?.monthly_cap_usd ?? "1300");

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const spentRows = await db
      .select({ total: sql<string>`coalesce(sum(${ai_trade_orders.usd_amount}), 0)` })
      .from(ai_trade_orders)
      .where(and(
        eq(ai_trade_orders.user_id, userId),
        eq(ai_trade_orders.status, "filled"),
        gte(ai_trade_orders.created_at, monthStart),
      ));
    const spent = parseFloat(spentRows[0]?.total ?? "0");

    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const recentBuys = await db
      .select()
      .from(ai_trade_orders)
      .where(and(
        eq(ai_trade_orders.user_id, userId),
        eq(ai_trade_orders.status, "filled"),
        gte(ai_trade_orders.created_at, weekAgo),
      ))
      .orderBy(desc(ai_trade_orders.created_at))
      .limit(8);

    const priceResults = await Promise.all(
      TOKENS.map(async (t) => ({ token: t, price: await getPrice(t, "crypto").then((d) => d?.price ?? null).catch(() => null) }))
    );
    const priceMap = new Map(priceResults.map((p) => [p.token, p.price]));

    let totalValue = 0;
    let totalCost = 0;
    const tokenLines: string[] = [];

    for (const token of TOKENS) {
      const h = holdingMap.get(token);
      if (!h || h.qty === 0) continue;
      const price = priceMap.get(token) ?? null;
      const value = price ? h.qty * price : 0;
      totalValue += value;
      totalCost += h.cost;
      const qtyStr = token === "BTC"
        ? h.qty.toFixed(5)
        : token === "ETH"
        ? h.qty.toFixed(4)
        : h.qty.toFixed(2);
      const pnl = value > 0 ? pnlStr(value, h.cost) : "no price";
      tokenLines.push(`${token.padEnd(5)} ${qtyStr} · ${usd(value)} · cost ${usd(h.cost)} · ${pnl}`);
    }

    lines.push("");
    lines.push("🟢 LIVE: CRYPTO DCA");
    lines.push(`Capital deployed: ${usd(totalCost)}`);
    for (const l of tokenLines) lines.push(l);
    if (totalValue > 0 && totalCost > 0) lines.push(`Total P&L: ${pnlStr(totalValue, totalCost)}`);
    lines.push(`Monthly cap: ${usd(spent)} / ${usd(cap)} used`);

    if (recentBuys.length > 0) {
      lines.push("");
      lines.push("Last buys (7d):");
      for (const b of recentBuys) {
        const dayStr = b.created_at.toLocaleDateString("en-US", {
          weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
        });
        const priceStr = b.price
          ? ` @ $${Math.round(parseFloat(b.price)).toLocaleString("en-US")}`
          : "";
        lines.push(`· ${b.token} ${usd(parseFloat(b.usd_amount))}${priceStr} (${dayStr})`);
      }
    } else {
      lines.push("No buys this week");
    }

    // ── Quant Scalper (Paper) ────────────────────────────────────────────────
    lines.push("");
    lines.push("📝 PAPER: QUANT SCALPER v4.1");
    try {
      const qRow = await db
        .select()
        .from(market_data_cache)
        .where(eq(market_data_cache.ticker, "quant:scrap:state"))
        .limit(1);
      if (qRow[0]) {
        const q = qRow[0].payload as QuantState;
        const startBal = q.starting_balance ?? 10000;
        const equity = q.equity ?? startBal;
        const pnl = equity - startBal;
        const pct = (pnl / startBal) * 100;
        lines.push(`Capital: ${usd(startBal)} (paper) → ${usd(equity)} (${pnl >= 0 ? "+" : ""}${pct.toFixed(1)}%)`);

        if (q.history && q.history.length >= 2) {
          const sorted = [...q.history].sort((a, b) => a.date.localeCompare(b.date));
          const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
          const base = sorted.filter((h) => h.date <= cutoff).at(-1) ?? sorted[0];
          const pnl7d = equity - base.equity;
          lines.push(`7d P&L: ${pnl7d >= 0 ? "+" : ""}${usd(Math.abs(pnl7d))}`);
        }

        if (q.backtest_stats) lines.push(`OOS Sharpe: ${q.backtest_stats.oos_sharpe.toFixed(2)}`);

        if (q.sleeve_weights) {
          const sw = Object.entries(q.sleeve_weights)
            .map(([k, v]) => `${k.toUpperCase()} ${(v * 100).toFixed(0)}%`)
            .join(" · ");
          lines.push(`Sleeves: ${sw}`);
        }

        const circuit = q.circuit_state ?? "NORMAL";
        lines.push(`Circuit: ${circuit} ${circuit === "NORMAL" ? "✅" : "⚠️"}`);
        if (q.regime) lines.push(`Regime: ${q.regime}`);
      } else {
        lines.push(`Capital: $10,000 (paper) — bot not yet run`);
      }
    } catch {
      lines.push("State unavailable");
    }

    // ── Options Wheel (Paper) ────────────────────────────────────────────────
    lines.push("");
    lines.push("📝 PAPER: OPTIONS WHEEL");
    try {
      const openPos = await db
        .select()
        .from(ai_options_positions)
        .where(and(
          eq(ai_options_positions.user_id, userId),
          eq(ai_options_positions.status, "open"),
        ));

      if (openPos.length === 0) {
        lines.push("No open positions");
      } else {
        const totalCollateral = openPos.reduce((s, p) => s + parseFloat(p.collateral_usd), 0);
        lines.push(`Collateral at risk: ${usd(totalCollateral)} (${openPos.length} position${openPos.length > 1 ? "s" : ""})`);
        for (const p of openPos) {
          const expStr = new Date(p.expiry).toLocaleDateString("en-US", {
            month: "short", day: "numeric", timeZone: "UTC",
          });
          const strikeStr = parseFloat(p.strike).toLocaleString("en-US", { maximumFractionDigits: 0 });
          const premStr = `prem $${parseFloat(p.entry_premium).toFixed(2)}`;
          const collStr = `coll ${usd(parseFloat(p.collateral_usd))}`;
          lines.push(`· ${p.underlying} ${strikeStr}${p.opt_type} ${expStr} · ${collStr} · ${premStr}`);
        }
      }
    } catch {
      lines.push("Positions unavailable");
    }

    // ── Dip-Bounce Signals ───────────────────────────────────────────────────
    lines.push("");
    lines.push("📡 DIP-BOUNCE TOP SIGNALS");
    try {
      const dipRow = await db
        .select()
        .from(market_data_cache)
        .where(eq(market_data_cache.ticker, "dipbounce:v1"))
        .limit(1);
      if (dipRow[0]) {
        const coins = (dipRow[0].payload as DipCoin[])
          .sort((a, b) => b.bounce_score - a.bounce_score)
          .slice(0, 3);
        lines.push(coins.map((c) => `${c.symbol} score ${c.bounce_score}`).join(" · "));
        lines.push("(signal only — no capital)");
      } else {
        lines.push("Scanner not yet run");
      }
    } catch {
      lines.push("Unavailable");
    }

    return lines.join("\n");
  } catch (err) {
    console.error("[portfolio-digest] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
