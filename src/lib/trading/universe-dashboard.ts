import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { universe_positions, universe_cooldowns, strategy_events } from "@/db/schema";
import { getPrice } from "@/lib/market";

// Mirrors quant-scrap/universe/universe_db.py:USER_ID and universe/config.py —
// the bot is single-tenant (its own hardcoded uuid, not the web session user),
// so the dashboard reads by that same constant rather than requireUser()'s id.
const USER_ID = "2d4c2a10-39d1-491c-ae39-18d515cd559e";
const STRATEGY_KEY = "universe-bot";

export const UNIVERSE: readonly string[] = [
  "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "AVGO", "AMD", "ARM", "PLTR",
  "COIN", "MSTR", "NFLX", "ORCL", "CRM", "MU", "QCOM", "ASML", "LRCX", "KLAC",
  "AMAT", "MRVL", "ADBE", "SHOP", "UBER", "SNOW", "NET", "CRWD", "PANW", "DDOG",
];

const MAX_POSITIONS = 5;
const POSITION_PCT = 0.20;
const STOP_PCT = 0.05;
const TARGET_PCT = 0.12;
const COOLDOWN_HOURS = 24;

export type WireOpenPosition = {
  symbol: string;
  qty: number;
  entryPrice: number;
  entryAt: string;
  stopPrice: number;
  targetPrice: number;
  price: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  hasOco: boolean;
  daysHeld: number;
};

export type WireClosedPosition = {
  symbol: string;
  qty: number;
  entryPrice: number;
  exitPrice: number | null;
  exitAt: string | null;
  exitReason: string | null;
  pnl: number | null;
};

export type WireObservingRow = {
  symbol: string;
  price: number | null;
  changePct: number | null;
  held: boolean;
  cooldownUntil: string | null;
};

export type WireTradeEvent = {
  id: string;
  symbol: string | null;
  side: string | null;
  qty: number | null;
  price: number | null;
  eventAt: string;
};

export type UniverseDashboardData = {
  maxPositions: number;
  positionPct: number;
  stopPct: number;
  targetPct: number;
  cooldownHours: number;
  openPositions: WireOpenPosition[];
  closedPositions: WireClosedPosition[];
  observing: WireObservingRow[];
  orderLog: WireTradeEvent[];
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  openCount: number;
};

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86_400_000));
}

export async function getUniverseDashboardData(): Promise<UniverseDashboardData> {
  const [openRows, closedRows, cooldownRows, tradeRows] = await Promise.all([
    db
      .select()
      .from(universe_positions)
      .where(and(eq(universe_positions.user_id, USER_ID), eq(universe_positions.still_open, true)))
      .orderBy(desc(universe_positions.entry_at)),
    db
      .select()
      .from(universe_positions)
      .where(and(eq(universe_positions.user_id, USER_ID), eq(universe_positions.still_open, false)))
      .orderBy(desc(universe_positions.exit_at))
      .limit(50),
    db.select().from(universe_cooldowns).where(eq(universe_cooldowns.user_id, USER_ID)),
    db
      .select()
      .from(strategy_events)
      .where(and(eq(strategy_events.user_id, USER_ID), eq(strategy_events.strategy_key, STRATEGY_KEY)))
      .orderBy(desc(strategy_events.event_at))
      .limit(100),
  ]);

  const heldSymbols = new Set(openRows.map((r) => r.symbol));
  const cooldownBySymbol = new Map(cooldownRows.map((r) => [r.symbol, r.until_at]));
  const now = new Date();

  const quotes = await Promise.all(
    UNIVERSE.map((symbol) => getPrice(symbol, "equity").catch(() => null)),
  );
  const quoteBySymbol = new Map(UNIVERSE.map((symbol, i) => [symbol, quotes[i]]));

  const openPositions: WireOpenPosition[] = openRows.map((r) => {
    const entryPrice = parseFloat(r.entry_price);
    const qty = parseFloat(r.qty);
    const q = quoteBySymbol.get(r.symbol) ?? null;
    const price = q?.price ?? null;
    const unrealizedPnl = price != null ? (price - entryPrice) * qty : null;
    return {
      symbol: r.symbol,
      qty,
      entryPrice,
      entryAt: r.entry_at.toISOString(),
      stopPrice: round2(entryPrice * (1 - STOP_PCT)),
      targetPrice: round2(entryPrice * (1 + TARGET_PCT)),
      price,
      unrealizedPnl: unrealizedPnl != null ? round2(unrealizedPnl) : null,
      unrealizedPnlPct: price != null ? (price - entryPrice) / entryPrice : null,
      hasOco: !!r.oco_order_id,
      daysHeld: daysBetween(r.entry_at, now),
    };
  });

  const closedPositions: WireClosedPosition[] = closedRows.map((r) => {
    const entryPrice = parseFloat(r.entry_price);
    const qty = parseFloat(r.qty);
    const exitPrice = r.exit_price != null ? parseFloat(r.exit_price) : null;
    return {
      symbol: r.symbol,
      qty,
      entryPrice,
      exitPrice,
      exitAt: r.exit_at ? r.exit_at.toISOString() : null,
      exitReason: r.exit_reason,
      pnl: exitPrice != null ? round2((exitPrice - entryPrice) * qty) : null,
    };
  });

  const observing: WireObservingRow[] = UNIVERSE.map((symbol) => {
    const q = quoteBySymbol.get(symbol) ?? null;
    const cooldownUntil = cooldownBySymbol.get(symbol) ?? null;
    return {
      symbol,
      price: q?.price ?? null,
      changePct: q?.change_pct ?? null,
      held: heldSymbols.has(symbol),
      cooldownUntil: cooldownUntil && cooldownUntil > now ? cooldownUntil.toISOString() : null,
    };
  });

  const orderLog: WireTradeEvent[] = tradeRows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    side: r.side,
    qty: r.quantity != null ? parseFloat(r.quantity) : null,
    price: r.price != null ? parseFloat(r.price) : null,
    eventAt: r.event_at.toISOString(),
  }));

  return {
    maxPositions: MAX_POSITIONS,
    positionPct: POSITION_PCT,
    stopPct: STOP_PCT,
    targetPct: TARGET_PCT,
    cooldownHours: COOLDOWN_HOURS,
    openPositions,
    closedPositions,
    observing,
    orderLog,
    totalUnrealizedPnl: round2(openPositions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0)),
    totalRealizedPnl: round2(closedPositions.reduce((s, p) => s + (p.pnl ?? 0), 0)),
    openCount: openPositions.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
