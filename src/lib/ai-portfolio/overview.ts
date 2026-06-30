import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  assets,
  ai_trade_orders,
  ai_options_positions,
  ai_options_wheel,
  ai_options_orders,
  market_data_cache,
} from "@/db/schema";
import { getPrice } from "@/lib/market";
import { getOrCreateSettings } from "@/lib/trading/settings";
import { getOrCreateOptionsSettings, type Underlying } from "@/lib/options/settings";

export type ActivityTone = "buy" | "sell" | "skip" | "info";
export type ActivityRow = {
  ts: string;            // ISO
  label: string;         // short — "BTC BUY", "SPY open_csp", "XAUUSD LONG"
  detail: string;        // human detail line
  tone: ActivityTone;
};
export type HoldingRow = {
  label: string;         // token / underlying / symbol / "OPEN"
  detail: string;        // qty / state / weight / position summary
  value?: number;        // USD value where meaningful
  pnl?: number | null;   // USD P/L where meaningful
};
export type BotHealth = "ok" | "warn" | "halt" | "stale";
export type BotStatus = {
  key: "crypto" | "options" | "quant" | "gold" | "pdhl";
  label: string;
  href: string;
  mode: "LIVE" | "PAPER";
  asset: string;
  equityOrValue: number;     // holdings value (crypto/options) or paper equity (scalpers)
  valueLabel: string;        // "Holdings" | "Paper equity"
  pnl: number | null;
  pnlPct: number | null;
  health: BotHealth;
  healthNote?: string;
  lastActivity: string | null;   // ISO
  holdings: HoldingRow[];
  recent: ActivityRow[];
  fallbackNote?: string;         // shown when recent is empty
};

const CRYPTO_TOKENS = ["BTC", "ETH", "SOL", "HYPE"] as const;
const DAY_MS = 86_400_000;

type QuantPayload = {
  equity?: number;
  starting_balance?: number;
  circuit_state?: string;
  regime?: string;
  top_positions?: { symbol: string; weight: number }[];
  recent_decisions?: {
    ts: string; symbol: string; action: string;
    prev_w?: number; weight: number; price?: number; regime?: string;
  }[];
  last_run?: string | null;
};
type GoldPayload = {
  equity?: number;
  starting_balance?: number;
  circuit_state?: string;
  regime?: string;
  open_position?: { direction: number; entry: number; size: number; stretch: number } | null;
  session?: { trades: number; win_rate: number | null; profit_factor: number | null; pnl: number };
  recent_trades?: {
    exit: string; side: "LONG" | "SHORT"; entry: number; exit_px: number;
    pnl: number; stretch: number; reason?: string;
  }[];
  last_run?: string | null;
};
type PDHLPayload = {
  equity?: number;
  starting_balance?: number;
  circuit_state?: string;
  open_position?: { direction: number; entry: number; level: number; size: number } | null;
  session?: { trades: number; win_rate: number | null; profit_factor: number | null; pnl: number };
  recent_trades?: {
    exit: string; side: "LONG" | "SHORT"; entry: number; exit_px: number;
    level: number; pnl: number; reason?: string;
  }[];
  last_run?: string | null;
};

async function cryptoStatus(userId: string): Promise<BotStatus> {
  const since = new Date(Date.now() - DAY_MS);
  const [settings, holdingRows, recentOrders] = await Promise.all([
    getOrCreateSettings(userId),
    db
      .select({ ticker: assets.ticker, qty: assets.qty, costBasis: assets.cost_basis })
      .from(assets)
      .where(and(eq(assets.user_id, userId), eq(assets.asset_class, "crypto"))),
    db
      .select()
      .from(ai_trade_orders)
      .where(and(eq(ai_trade_orders.user_id, userId), gte(ai_trade_orders.created_at, since)))
      .orderBy(desc(ai_trade_orders.created_at))
      .limit(20),
  ]);

  const byToken = new Map<string, { qty: number; cost: number }>();
  for (const h of holdingRows) {
    if (!h.ticker) continue;
    const t = h.ticker.toUpperCase();
    const prev = byToken.get(t) ?? { qty: 0, cost: 0 };
    byToken.set(t, {
      qty: prev.qty + (h.qty ? parseFloat(h.qty) : 0),
      cost: prev.cost + (h.costBasis ? parseFloat(h.costBasis) : 0),
    });
  }

  const prices = await Promise.all(
    CRYPTO_TOKENS.map((t) => getPrice(t, "crypto").then((d) => d?.price ?? null).catch(() => null))
  );
  const priceByToken = new Map(CRYPTO_TOKENS.map((t, i) => [t, prices[i]]));

  const holdings: HoldingRow[] = [];
  let totalValue = 0;
  let totalCost = 0;
  for (const token of CRYPTO_TOKENS) {
    const h = byToken.get(token);
    if (!h || h.qty === 0) continue;
    const price = priceByToken.get(token) ?? null;
    const value = price ? h.qty * price : 0;
    totalValue += value;
    totalCost += h.cost;
    holdings.push({
      label: token,
      detail: `${h.qty.toFixed(token === "BTC" ? 5 : 4)} @ ${price ? `$${Math.round(price).toLocaleString("en-US")}` : "—"}`,
      value,
      pnl: value > 0 ? value - h.cost : null,
    });
  }

  const pnl = totalValue > 0 ? totalValue - totalCost : null;
  const pnlPct = pnl != null && totalCost > 0 ? (pnl / totalCost) * 100 : null;

  const recent: ActivityRow[] = recentOrders.map((o) => ({
    ts: o.created_at.toISOString(),
    label: `${o.token} ${o.status === "filled" ? "BUY" : o.status.toUpperCase()}`,
    detail:
      o.status === "filled"
        ? `$${parseFloat(o.usd_amount).toFixed(0)}${o.price ? ` @ $${Math.round(parseFloat(o.price)).toLocaleString("en-US")}` : ""}${o.boosted ? " · boosted" : ""}`
        : (o.error ?? "skipped — not in buy-zone / cap / cadence"),
    tone: o.status === "filled" ? "buy" : "skip",
  }));

  return {
    key: "crypto",
    label: "CRYPTO DCA",
    href: "/ai-portfolio/crypto",
    mode: "LIVE",
    asset: "BTC·ETH·SOL·HYPE",
    equityOrValue: totalValue,
    valueLabel: "Holdings",
    pnl,
    pnlPct,
    health: settings.kill_switch ? "warn" : "ok",
    healthNote: settings.kill_switch ? "kill switch ON — halted" : undefined,
    lastActivity: recentOrders[0]?.created_at.toISOString() ?? null,
    holdings,
    recent,
    fallbackNote: recent.length === 0 ? "No DCA due in last 24h — waiting for next per-token cadence window." : undefined,
  };
}

async function optionsStatus(userId: string): Promise<BotStatus> {
  const since = new Date(Date.now() - DAY_MS);
  const [settings, wheelRows, openPos, settledAgg, recentOrders] = await Promise.all([
    getOrCreateOptionsSettings(userId),
    db.select().from(ai_options_wheel).where(eq(ai_options_wheel.user_id, userId)),
    db
      .select()
      .from(ai_options_positions)
      .where(and(eq(ai_options_positions.user_id, userId), eq(ai_options_positions.status, "open"))),
    db
      .select({
        underlying: ai_options_positions.underlying,
        totalPnl: sql<string>`coalesce(sum(${ai_options_positions.realized_pnl}), 0)`,
      })
      .from(ai_options_positions)
      .where(and(eq(ai_options_positions.user_id, userId), sql`${ai_options_positions.status} != 'open'`))
      .groupBy(ai_options_positions.underlying),
    db
      .select()
      .from(ai_options_orders)
      .where(and(eq(ai_options_orders.user_id, userId), gte(ai_options_orders.created_at, since)))
      .orderBy(desc(ai_options_orders.created_at))
      .limit(20),
  ]);

  const settledByUnderlying = new Map(settledAgg.map((r) => [r.underlying, parseFloat(r.totalPnl)]));
  const wheelByUnderlying = new Map(wheelRows.map((r) => [r.underlying, r]));
  const underlyings = (settings.underlyings as Underlying[]) ?? [];

  const holdings: HoldingRow[] = underlyings.map((u) => {
    const wheel = wheelByUnderlying.get(u.symbol);
    const open = openPos.filter((p) => p.underlying === u.symbol);
    const realized = settledByUnderlying.get(u.symbol) ?? 0;
    const state = wheel?.state ?? (u.mode === "pmcc" ? "pmcc_cash" : "cash");
    const shares = parseFloat(wheel?.shares ?? "0");
    const modeTag = u.mode === "pmcc" ? "PMCC" : "WHL";
    let detail: string;
    if (state === "pmcc_holding_leaps") {
      const leapsK = wheel?.leaps_strike ? `$${Math.round(parseFloat(wheel.leaps_strike))}` : "?";
      const leapsExp = wheel?.leaps_expiry
        ? new Date(wheel.leaps_expiry).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "?";
      detail = `LEAPS ${leapsK} exp ${leapsExp} · ${open.length} open`;
    } else if (state === "pmcc_cash") {
      detail = `PMCC cash · ${open.length} open`;
    } else if (state === "holding_stock") {
      detail = `holding ${shares} sh · ${open.length} open`;
    } else {
      detail = `cash · ${open.length} open`;
    }
    return {
      label: `${u.symbol} [${modeTag}]`,
      detail,
      pnl: realized,
    };
  });

  const totalRealized = [...settledByUnderlying.values()].reduce((s, v) => s + v, 0);
  const totalCollateral = openPos
    .filter((p) => p.strategy === "csp")
    .reduce((s, p) => s + parseFloat(p.collateral_usd), 0);

  const recent: ActivityRow[] = recentOrders.map((o) => {
    const d = (o.detail as Record<string, unknown> | null) ?? {};
    const bits = [d.strike, d.expiry, d.premium].filter(Boolean).join(" · ");
    return {
      ts: o.created_at.toISOString(),
      label: `${o.underlying} ${o.action}`,
      detail: bits || (o.action === "skip" ? "no qualifying contract / low conviction" : ""),
      tone: o.action === "skip" ? "skip" : o.action.startsWith("open") ? "sell" : "info",
    };
  });

  return {
    key: "options",
    label: "OPTIONS WHEEL",
    href: "/ai-portfolio/options",
    mode: "PAPER",
    asset: underlyings.map((u) => u.symbol).join("·") || "—",
    equityOrValue: totalCollateral,
    valueLabel: "Collateral at risk",
    pnl: totalRealized,
    pnlPct: null,
    health: settings.kill_switch ? "warn" : "ok",
    healthNote: settings.kill_switch ? "kill switch ON — halted" : undefined,
    lastActivity: recentOrders[0]?.created_at.toISOString() ?? null,
    holdings,
    recent,
    fallbackNote: recent.length === 0 ? "No action in last 24h — runs weekly (Mondays UTC). PMCC: buy LEAPS → sell short calls." : undefined,
  };
}

async function cacheStatus(key: string) {
  const rows = await db
    .select()
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, key))
    .limit(1);
  return rows[0] ?? null;
}

async function quantStatus(): Promise<BotStatus> {
  const row = await cacheStatus("quant:scrap:state");
  const p = (row?.payload as QuantPayload) ?? {};
  const start = p.starting_balance ?? 10000;
  const equity = p.equity ?? start;
  const pnl = equity - start;
  const fetchedAt = row?.fetched_at ?? null;
  const ageH = fetchedAt ? (Date.now() - new Date(fetchedAt).getTime()) / 3_600_000 : Infinity;

  let health: BotHealth = "ok";
  let healthNote: string | undefined;
  if (!row) { health = "stale"; healthNote = "never published"; }
  else if ((p.circuit_state ?? "NORMAL") !== "NORMAL" && p.circuit_state !== "RESUME") { health = "halt"; healthNote = `circuit ${p.circuit_state}`; }
  else if (ageH > 26) { health = "stale"; healthNote = `no run in ${Math.round(ageH)}h`; }

  const holdings: HoldingRow[] = (p.top_positions ?? []).slice(0, 6).map((t) => ({
    label: t.symbol,
    detail: `weight ${(t.weight * 100).toFixed(1)}%`,
  }));

  const recent: ActivityRow[] = (p.recent_decisions ?? []).slice(0, 12).map((d) => ({
    ts: d.ts,
    label: `${d.symbol} ${d.action.toUpperCase()}`,
    detail: `${((d.prev_w ?? 0) * 100).toFixed(1)}% → ${(d.weight * 100).toFixed(1)}%${d.price ? ` @ $${d.price.toLocaleString("en-US")}` : ""}`,
    tone: d.action === "close" || d.action === "reduce" ? "sell" : "buy",
  }));

  return {
    key: "quant",
    label: "QUANT SCALPER",
    href: "/ai-portfolio/quant-scalper",
    mode: "PAPER",
    asset: "BTC·ETH·BNB +",
    equityOrValue: equity,
    valueLabel: "Paper equity",
    pnl,
    pnlPct: start > 0 ? (pnl / start) * 100 : null,
    health,
    healthNote,
    lastActivity: p.last_run ?? (fetchedAt ? new Date(fetchedAt).toISOString() : null),
    holdings,
    recent,
    fallbackNote: recent.length === 0 ? `No rebalance crossed threshold recently${p.regime ? ` · regime ${p.regime}` : ""}.` : undefined,
  };
}

async function goldStatus(): Promise<BotStatus> {
  const row = await cacheStatus("gold:scalper:state");
  const p = (row?.payload as GoldPayload) ?? {};
  const start = p.starting_balance ?? 10000;
  const equity = p.equity ?? start;
  const pnl = equity - start;
  const fetchedAt = row?.fetched_at ?? null;
  const ageMin = fetchedAt ? (Date.now() - new Date(fetchedAt).getTime()) / 60_000 : Infinity;

  // Gold trades London+NY session 07:00–21:00 UTC, but OANDA closes Fri 21:00–Sun 21:00 UTC.
  const _now = new Date();
  const utcHour = _now.getUTCHours();
  const utcDay  = _now.getUTCDay(); // 0=Sun, 6=Sat
  const oandaOpen = !(utcDay === 6 || (utcDay === 0 && utcHour < 21) || (utcDay === 5 && utcHour >= 21));
  const inSession = oandaOpen && utcHour >= 7 && utcHour < 21;
  let health: BotHealth = "ok";
  let healthNote: string | undefined;
  if (!row) { health = "stale"; healthNote = "never published"; }
  else if ((p.circuit_state ?? "NORMAL") !== "NORMAL" && p.circuit_state !== "RESUME") { health = "halt"; healthNote = `circuit ${p.circuit_state}`; }
  else if (inSession && ageMin > 15) { health = "stale"; healthNote = `poller stale ${Math.round(ageMin)}m`; }

  const pos = p.open_position;
  const holdings: HoldingRow[] = pos
    ? [{
        label: pos.direction > 0 ? "LONG" : "SHORT",
        detail: `entry $${pos.entry.toLocaleString("en-US")} · ${pos.stretch.toFixed(2)}σ · ${pos.size.toFixed(4)} oz`,
      }]
    : [];

  const recent: ActivityRow[] = (p.recent_trades ?? []).slice(0, 12).map((t) => ({
    ts: t.exit,
    label: `XAUUSD ${t.side}`,
    detail: `${t.entry.toLocaleString("en-US")} → ${t.exit_px.toLocaleString("en-US")} · ${t.stretch.toFixed(2)}σ${t.reason ? ` · ${t.reason}` : ""}`,
    tone: t.pnl >= 0 ? "buy" : "sell",
  }));

  const sess = p.session;
  return {
    key: "gold",
    label: "GOLD SCALPER",
    href: "/ai-portfolio/gold-scalper",
    mode: "PAPER",
    asset: "XAUUSD",
    equityOrValue: equity,
    valueLabel: "Paper equity",
    pnl,
    pnlPct: start > 0 ? (pnl / start) * 100 : null,
    health,
    healthNote,
    lastActivity: p.last_run ?? (fetchedAt ? new Date(fetchedAt).toISOString() : null),
    holdings,
    recent,
    fallbackNote:
      recent.length === 0
        ? pos
          ? "Open fade running — no closed trades in last 24h."
          : `FLAT — waiting for a ranging-session 3σ stretch${sess ? ` · today ${sess.trades} trades` : ""}.`
        : undefined,
  };
}

async function pdhlStatus(): Promise<BotStatus> {
  const row = await cacheStatus("gold:pdhl:state");
  const p = (row?.payload as PDHLPayload) ?? {};
  const start = p.starting_balance ?? 10000;
  const equity = p.equity ?? start;
  const pnl = equity - start;
  const fetchedAt = row?.fetched_at ?? null;
  const ageMin = fetchedAt ? (Date.now() - new Date(fetchedAt).getTime()) / 60_000 : Infinity;

  const _now2 = new Date();
  const utcHour2 = _now2.getUTCHours();
  const utcDay2  = _now2.getUTCDay();
  const oandaOpen2 = !(utcDay2 === 6 || (utcDay2 === 0 && utcHour2 < 21) || (utcDay2 === 5 && utcHour2 >= 21));
  const inSession = oandaOpen2 && utcHour2 >= 7 && utcHour2 < 21;
  let health: BotHealth = "ok";
  let healthNote: string | undefined;
  if (!row) { health = "stale"; healthNote = "never published"; }
  else if ((p.circuit_state ?? "NORMAL") !== "NORMAL" && p.circuit_state !== "RESUME") { health = "halt"; healthNote = `circuit ${p.circuit_state}`; }
  else if (inSession && ageMin > 15) { health = "stale"; healthNote = `poller stale ${Math.round(ageMin)}m`; }

  const pos = p.open_position;
  const holdings: HoldingRow[] = pos
    ? [{
        label: pos.direction > 0 ? "LONG" : "SHORT",
        detail: `entry $${pos.entry.toLocaleString("en-US")} · level $${pos.level.toLocaleString("en-US")} · ${pos.size.toFixed(4)} oz`,
      }]
    : [];

  const recent: ActivityRow[] = (p.recent_trades ?? []).slice(0, 12).map((t) => ({
    ts: t.exit,
    label: `XAUUSD ${t.side}`,
    detail: `${t.entry.toLocaleString("en-US")} → ${t.exit_px.toLocaleString("en-US")} · PDH/PDL $${t.level.toLocaleString("en-US")}${t.reason ? ` · ${t.reason}` : ""}`,
    tone: t.pnl >= 0 ? "buy" : "sell",
  }));

  const sess = p.session;
  return {
    key: "pdhl",
    label: "PDH/PDL SCALPER",
    href: "/ai-portfolio/pdhl-scalper",
    mode: "PAPER",
    asset: "XAUUSD",
    equityOrValue: equity,
    valueLabel: "Paper equity",
    pnl,
    pnlPct: start > 0 ? (pnl / start) * 100 : null,
    health,
    healthNote,
    lastActivity: p.last_run ?? (fetchedAt ? new Date(fetchedAt).toISOString() : null),
    holdings,
    recent,
    fallbackNote:
      recent.length === 0
        ? pos
          ? "Break+retest trade open — no closed trades in last 24h."
          : `FLAT — waiting for PDH/PDL break+retest${sess ? ` · today ${sess.trades} trades` : ""}.`
        : undefined,
  };
}

export async function getBotOverview(userId: string): Promise<BotStatus[]> {
  const [crypto, options, quant, gold, pdhl] = await Promise.all([
    cryptoStatus(userId).catch((e) => errorStatus("crypto", e)),
    optionsStatus(userId).catch((e) => errorStatus("options", e)),
    quantStatus().catch((e) => errorStatus("quant", e)),
    goldStatus().catch((e) => errorStatus("gold", e)),
    pdhlStatus().catch((e) => errorStatus("pdhl", e)),
  ]);
  return [crypto, options, quant, gold, pdhl];
}

function errorStatus(key: BotStatus["key"], err: unknown): BotStatus {
  const meta: Record<BotStatus["key"], { label: string; href: string; mode: "LIVE" | "PAPER"; asset: string }> = {
    crypto: { label: "CRYPTO DCA", href: "/ai-portfolio/crypto", mode: "LIVE", asset: "BTC·ETH·SOL·HYPE" },
    options: { label: "OPTIONS WHEEL", href: "/ai-portfolio/options", mode: "PAPER", asset: "—" },
    quant: { label: "QUANT SCALPER", href: "/ai-portfolio/quant-scalper", mode: "PAPER", asset: "BTC·ETH·BNB +" },
    gold: { label: "GOLD SCALPER", href: "/ai-portfolio/gold-scalper", mode: "PAPER", asset: "XAUUSD" },
    pdhl: { label: "PDH/PDL SCALPER", href: "/ai-portfolio/pdhl-scalper", mode: "PAPER", asset: "XAUUSD" },
  };
  const m = meta[key];
  console.error(`[overview] ${key} failed:`, err instanceof Error ? err.message : err);
  return {
    key, ...m,
    equityOrValue: 0, valueLabel: "—", pnl: null, pnlPct: null,
    health: "stale", healthNote: "data read failed",
    lastActivity: null, holdings: [], recent: [],
    fallbackNote: "Could not load this bot's data.",
  };
}
