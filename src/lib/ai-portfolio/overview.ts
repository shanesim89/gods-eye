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
  daily_pnl,
} from "@/db/schema";
import { computeDailyRows } from "@/lib/trading/daily-snapshot";
import { getPrice } from "@/lib/market";
import { getOrCreateSettings } from "@/lib/trading/settings";
import { getOrCreateOptionsSettings, type Underlying } from "@/lib/options/settings";
import { accountingBots, fleetBookValue, fleetPnl } from "@/lib/ai-portfolio/fleet";

export type ActivityTone = "buy" | "sell" | "skip" | "info" | "error";
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
export type BotHealth = "ok" | "warn" | "halt" | "stale" | "off";
export type BotKey =
  | "crypto" | "options" | "quant" | "gold"
  | "pdhl" | "pdhl4h" | "pdhl8h";
export type BotStatus = {
  key: BotKey;
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
  openPositions?: number;        // live position count for the fleet row
  alert?: string | null;         // urgent surface-on-homepage condition (e.g. failed live order)
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
  // 48h window so a failed order from yesterday's cron still raises the alert
  // (this is real money — silent failures must surface on the homepage).
  const since = new Date(Date.now() - 2 * DAY_MS);
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
        : o.status === "failed"
        ? (o.error ?? "order failed")
        : (o.error ?? "skipped — not in buy-zone / cap / cadence"),
    tone: o.status === "filled" ? "buy" : o.status === "failed" ? "error" : "skip",
  }));

  const lastFailed = recentOrders.find((o) => o.status === "failed");

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
    health: settings.kill_switch ? "warn" : lastFailed ? "warn" : "ok",
    healthNote: settings.kill_switch
      ? "kill switch ON — halted"
      : lastFailed
      ? `last ${lastFailed.token} order FAILED`
      : undefined,
    lastActivity: recentOrders[0]?.created_at.toISOString() ?? null,
    holdings,
    recent,
    fallbackNote: recent.length === 0 ? "No DCA due in last 48h — waiting for next per-token cadence window." : undefined,
    openPositions: holdings.length,
    alert: lastFailed
      ? `${lastFailed.token} buy FAILED ${rel48(lastFailed.created_at)} — ${(lastFailed.error ?? "unknown error").slice(0, 80)}`
      : null,
  };
}

function rel48(d: Date): string {
  const h = (Date.now() - d.getTime()) / 3_600_000;
  return h < 1 ? `${Math.round(h * 60)}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
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
    openPositions: openPos.length,
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
    openPositions: (p.top_positions ?? []).length,
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
    openPositions: pos ? 1 : 0,
  };
}

// One PDHL status per period — daily/4H/8H bots publish to separate Neon keys.
const PDHL_VARIANTS: Record<"pdhl" | "pdhl4h" | "pdhl8h", { cacheKey: string; label: string }> = {
  pdhl:   { cacheKey: "gold:pdhl:state",     label: "PDH/PDL DAILY" },
  pdhl4h: { cacheKey: "gold:pdhl:4h:state",  label: "PDH/PDL 4H" },
  pdhl8h: { cacheKey: "gold:pdhl:8h:state",  label: "PDH/PDL 8H" },
};

// 4H/8H systemd units are deliberately `disabled` (benched per the goldscalp
// strategy audit — shared-params bleed, not a bug). Nothing has published to
// their Neon keys since, and nothing will until Shane re-enables them — so
// treat them as intentionally "off" rather than ever computing "stale" and
// putting them in the ATTENTION banner next to bots that are actually broken.
const BENCHED_PDHL = new Set<"pdhl" | "pdhl4h" | "pdhl8h">(["pdhl4h", "pdhl8h"]);

async function pdhlStatus(variant: "pdhl" | "pdhl4h" | "pdhl8h" = "pdhl"): Promise<BotStatus> {
  const { cacheKey, label } = PDHL_VARIANTS[variant];
  const row = await cacheStatus(cacheKey);
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
  if (BENCHED_PDHL.has(variant)) { health = "off"; healthNote = "benched — disabled on purpose"; }
  else if (!row) { health = "stale"; healthNote = "never published"; }
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
  const benched = health === "off";
  return {
    key: variant,
    label,
    href: "/ai-portfolio/pdhl-scalper",
    mode: "PAPER",
    asset: "XAUUSD",
    equityOrValue: benched ? 0 : equity,
    valueLabel: benched ? "Benched" : "Paper equity",
    pnl: benched ? null : pnl,
    pnlPct: benched || start <= 0 ? null : (pnl / start) * 100,
    health,
    healthNote,
    lastActivity: benched ? null : p.last_run ?? (fetchedAt ? new Date(fetchedAt).toISOString() : null),
    holdings: benched ? [] : holdings,
    recent: benched ? [] : recent,
    fallbackNote: benched
      ? "Disabled on purpose — retained for visibility, excluded from fleet accounting."
      : recent.length === 0
        ? pos
          ? "Break+retest trade open — no closed trades in last 24h."
          : `FLAT — waiting for PDH/PDL break+retest${sess ? ` · today ${sess.trades} trades` : ""}.`
        : undefined,
    openPositions: benched ? 0 : pos ? 1 : 0,
  };
}

export async function getBotOverview(userId: string): Promise<BotStatus[]> {
  const [crypto, options, quant, gold, pdhl, pdhl4h, pdhl8h] = await Promise.all([
    cryptoStatus(userId).catch((e) => errorStatus("crypto", e)),
    optionsStatus(userId).catch((e) => errorStatus("options", e)),
    quantStatus().catch((e) => errorStatus("quant", e)),
    goldStatus().catch((e) => errorStatus("gold", e)),
    pdhlStatus().catch((e) => errorStatus("pdhl", e)),
    pdhlStatus("pdhl4h").catch((e) => errorStatus("pdhl4h", e)),
    pdhlStatus("pdhl8h").catch((e) => errorStatus("pdhl8h", e)),
  ]);
  return [crypto, options, quant, gold, pdhl, pdhl4h, pdhl8h];
}

// ── 30-day P/L calendar ──────────────────────────────────────────────────────
export type DailyBotCell = {
  bot: BotKey;
  label: string;
  pnl: number | null;        // realized P/L that day; null = no data / no P/L concept (crypto)
  returnPct: number | null;
  activityCount: number;     // trades/orders that day
};
export type DailyCell = {
  day: string;               // "YYYY-MM-DD" (UTC)
  netPnl: number;            // sum of non-null bot pnl
  active: boolean;           // any bot had activity that day
  bots: DailyBotCell[];      // point-form per-bot breakdown (all bots, "—" where no data)
};

// Bots shown per day, stable order.
const CAL_BOTS: { key: BotKey; label: string }[] = [
  { key: "gold", label: "GOLD SCALPER" },
  { key: "pdhl", label: "PDH/PDL DAILY" },
  { key: "quant", label: "QUANT SCALPER" },
  { key: "options", label: "OPTIONS WHEEL" },
  { key: "crypto", label: "CRYPTO DCA" },
];

export async function buildDailyCalendar(userId: string): Promise<DailyCell[]> {
  const [dbRows, todayRows] = await Promise.all([
    db
      .select({
        day: daily_pnl.day,
        bot: daily_pnl.bot,
        realized_pnl: daily_pnl.realized_pnl,
        return_pct: daily_pnl.return_pct,
        activity_count: daily_pnl.activity_count,
      })
      .from(daily_pnl)
      .where(and(eq(daily_pnl.user_id, userId), gte(daily_pnl.day, sql`current_date - 29`))),
    // Today isn't snapshotted yet (cron writes yesterday) — reconstruct live.
    computeDailyRows(userId, new Date()).catch(() => []),
  ]);

  type Cell = { pnl: number | null; returnPct: number | null; activity: number };
  const byDay = new Map<string, Map<string, Cell>>();
  const put = (day: string, bot: string, c: Cell) => {
    let m = byDay.get(day);
    if (!m) { m = new Map(); byDay.set(day, m); }
    m.set(bot, c);
  };
  for (const r of dbRows) {
    put(r.day, r.bot, {
      pnl: r.realized_pnl == null ? null : parseFloat(r.realized_pnl),
      returnPct: r.return_pct == null ? null : parseFloat(r.return_pct),
      activity: r.activity_count,
    });
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const r of todayRows) {
    put(todayStr, r.bot, { pnl: r.realized_pnl, returnPct: r.return_pct, activity: r.activity_count });
  }

  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cells: DailyCell[] = [];
  for (let i = 29; i >= 0; i--) {
    const dayStr = new Date(todayUTC - i * DAY_MS).toISOString().slice(0, 10);
    const m = byDay.get(dayStr);
    const bots: DailyBotCell[] = CAL_BOTS.map((b) => {
      const v = m?.get(b.key);
      return {
        bot: b.key,
        label: b.label,
        pnl: v?.pnl ?? null,
        returnPct: v?.returnPct ?? null,
        activityCount: v?.activity ?? 0,
      };
    });
    const netPnl = bots.reduce((s, b) => s + (b.pnl ?? 0), 0);
    // "Active" = any real data that day (a trade/order OR a realized P/L reading).
    // Days with neither render as the highlighted "no activity / market closed" state.
    const active = bots.some((b) => b.activityCount > 0 || b.pnl != null);
    cells.push({ day: dayStr, netPnl, active, bots });
  }
  return cells;
}

// ── Homepage command-center aggregate ────────────────────────────────────────
export type HomeActivityRow = ActivityRow & { bot: BotKey; botLabel: string };
export type HomeState = {
  live: BotStatus[];
  paper: BotStatus[];
  hero: {
    totalBook: number;      // live holdings value + paper equities
    todayPnl: number;       // sum of last-24h realized PnL visible in activity
    ok: number; warn: number; halt: number; stale: number; off: number;
  };
  alerts: string[];         // urgent red-banner lines (bot alerts + health issues)
  activity: HomeActivityRow[]; // merged 48h feed, newest first
  daily: DailyCell[];       // 30-day P/L calendar, oldest → newest
  generatedAt: string;
};

export async function buildHomeState(userId: string): Promise<HomeState> {
  // Kick off the calendar query concurrently with the bot-status fan-out.
  const dailyP = buildDailyCalendar(userId).catch((e) => {
    console.error("[overview] daily calendar failed:", e instanceof Error ? e.message : e);
    return [] as DailyCell[];
  });
  const [crypto, options, quant, gold, pdhl, pdhl4h, pdhl8h] = await Promise.all([
    cryptoStatus(userId).catch((e) => errorStatus("crypto", e)),
    optionsStatus(userId).catch((e) => errorStatus("options", e)),
    quantStatus().catch((e) => errorStatus("quant", e)),
    goldStatus().catch((e) => errorStatus("gold", e)),
    pdhlStatus("pdhl").catch((e) => errorStatus("pdhl", e)),
    pdhlStatus("pdhl4h").catch((e) => errorStatus("pdhl4h", e)),
    pdhlStatus("pdhl8h").catch((e) => errorStatus("pdhl8h", e)),
  ]);

  const live = [crypto];
  const paper = [gold, pdhl, pdhl4h, pdhl8h, quant, options];
  const visible = [...live, ...paper];
  const active = accountingBots(visible);
  const activePaper = accountingBots(paper);

  const totalBook = fleetBookValue(active);

  const cutoff = Date.now() - 2 * DAY_MS;
  const activity: HomeActivityRow[] = active
    .flatMap((b) => b.recent.map((r) => ({ ...r, bot: b.key, botLabel: b.label })))
    .filter((r) => {
      const t = new Date(r.ts).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 50);

  // Today's P/L: paper bots report equity-vs-start; approximate the daily number
  // from session pnl where present is bot-specific, so use the simple honest sum
  // of each bot's pnl exposed today — crypto uses holdings pnl (all-time), so
  // exclude it and label the tile PAPER P/L + live P/L separately in the UI.
  const todayPnl = fleetPnl(activePaper);

  const counts = { ok: 0, warn: 0, halt: 0, stale: 0, off: 0 };
  for (const b of visible) counts[b.health] += 1;

  const alerts: string[] = [];
  for (const b of active) {
    if (b.alert) alerts.push(`${b.label}: ${b.alert}`);
    else if (b.health === "halt") alerts.push(`${b.label}: ${b.healthNote ?? "halted"}`);
    else if (b.health === "stale") alerts.push(`${b.label}: ${b.healthNote ?? "stale"}`);
  }

  const daily = await dailyP;

  return {
    live,
    paper,
    hero: { totalBook, todayPnl, ...counts },
    alerts,
    activity,
    daily,
    generatedAt: new Date().toISOString(),
  };
}

function errorStatus(key: BotKey, err: unknown): BotStatus {
  const meta: Record<BotKey, { label: string; href: string; mode: "LIVE" | "PAPER"; asset: string }> = {
    crypto: { label: "CRYPTO DCA", href: "/ai-portfolio/crypto", mode: "LIVE", asset: "BTC·ETH·SOL·HYPE" },
    options: { label: "OPTIONS WHEEL", href: "/ai-portfolio/options", mode: "PAPER", asset: "—" },
    quant: { label: "QUANT SCALPER", href: "/ai-portfolio/quant-scalper", mode: "PAPER", asset: "BTC·ETH·BNB +" },
    gold: { label: "GOLD SCALPER", href: "/ai-portfolio/gold-scalper", mode: "PAPER", asset: "XAUUSD" },
    pdhl: { label: "PDH/PDL DAILY", href: "/ai-portfolio/pdhl-scalper", mode: "PAPER", asset: "XAUUSD" },
    pdhl4h: { label: "PDH/PDL 4H", href: "/ai-portfolio/pdhl-scalper", mode: "PAPER", asset: "XAUUSD" },
    pdhl8h: { label: "PDH/PDL 8H", href: "/ai-portfolio/pdhl-scalper", mode: "PAPER", asset: "XAUUSD" },
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
