import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  ai_options_positions,
  ai_options_orders,
  ai_trade_orders,
  market_data_cache,
  daily_pnl,
} from "@/db/schema";

// Writes durable per-bot rows into daily_pnl for ONE completed UTC day. Run by
// the daily cron for "yesterday" (the last full 24h). Only writes a row when a
// bot actually had activity or a real realized-P/L delta that day — never filler
// zero-rows — so absence of a row means "no activity", which the calendar
// highlights. Idempotent via the (user_id, day, bot) PK: re-runs overwrite.
//
// Sources per bot mirror overview.ts:
//   options   — ai_options_positions.realized_pnl by settled_at (true realized)
//   quant     — quant:scrap:state history[] equity delta
//   scalpers  — *:state recent_trades[] pnl summed in the day window
//   crypto    — ai_trade_orders count (no realized_pnl concept — activity only)

type Row = {
  bot: string;
  realized_pnl: number | null;
  return_pct: number | null;
  activity_count: number;
  equity: number | null;
};

const SCALPERS: { bot: string; key: string }[] = [
  { bot: "gold", key: "gold:scalper:state" },
  { bot: "pdhl", key: "gold:pdhl:state" },
];

async function cachePayload<T>(key: string): Promise<T | null> {
  const rows = await db
    .select({ payload: market_data_cache.payload })
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, key))
    .limit(1);
  return (rows[0]?.payload as T) ?? null;
}

/** UTC-midnight start of the given day, plus [start, end) 24h window. */
export function utcDayWindow(day: Date): { dayStr: string; start: Date; end: Date } {
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  return { dayStr: start.toISOString().slice(0, 10), start, end };
}

export async function computeDailyRows(userId: string, day: Date): Promise<Row[]> {
  const { dayStr, start, end } = utcDayWindow(day);
  const rows: Row[] = [];

  // ── options — real realized P/L settled that day + engine actions ──────────
  try {
    const [settled, orders] = await Promise.all([
      db
        .select({
          pnl: sql<string>`coalesce(sum(${ai_options_positions.realized_pnl}), 0)`,
          n: sql<number>`count(*)`,
        })
        .from(ai_options_positions)
        .where(
          and(
            eq(ai_options_positions.user_id, userId),
            sql`${ai_options_positions.status} != 'open'`,
            gte(ai_options_positions.settled_at, start),
            lt(ai_options_positions.settled_at, end),
          ),
        ),
      db
        .select({ n: sql<number>`count(*)` })
        .from(ai_options_orders)
        .where(
          and(
            eq(ai_options_orders.user_id, userId),
            gte(ai_options_orders.created_at, start),
            lt(ai_options_orders.created_at, end),
          ),
        ),
    ]);
    const settledN = Number(settled[0]?.n ?? 0);
    const orderN = Number(orders[0]?.n ?? 0);
    const activity = settledN + orderN;
    if (activity > 0) {
      rows.push({
        bot: "options",
        realized_pnl: parseFloat(settled[0]?.pnl ?? "0"),
        return_pct: null,
        activity_count: activity,
        equity: null,
      });
    }
  } catch (e) {
    console.error("[daily-snapshot] options failed:", e instanceof Error ? e.message : e);
  }

  // ── quant — equity delta from history[] curve ──────────────────────────────
  try {
    const p = await cachePayload<{
      history?: { date: string; equity: number }[];
      recent_decisions?: { ts: string }[];
    }>("quant:scrap:state");
    const hist = [...(p?.history ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const idx = hist.findIndex((h) => h.date === dayStr);
    if (idx >= 0) {
      const cur = hist[idx].equity;
      const prev = idx > 0 ? hist[idx - 1].equity : cur;
      const delta = cur - prev;
      const decisions = (p?.recent_decisions ?? []).filter(
        (d) => (d.ts ?? "").slice(0, 10) === dayStr,
      ).length;
      if (delta !== 0 || decisions > 0) {
        rows.push({
          bot: "quant",
          realized_pnl: delta,
          return_pct: prev > 0 ? (delta / prev) * 100 : null,
          activity_count: decisions,
          equity: cur,
        });
      }
    }
  } catch (e) {
    console.error("[daily-snapshot] quant failed:", e instanceof Error ? e.message : e);
  }

  // ── scalpers — sum recent_trades[] pnl in the day window ───────────────────
  for (const { bot, key } of SCALPERS) {
    try {
      const p = await cachePayload<{
        equity?: number;
        starting_balance?: number;
        recent_trades?: { exit: string; pnl: number }[];
      }>(key);
      const trades = (p?.recent_trades ?? []).filter((t) => {
        const ts = new Date(t.exit).getTime();
        return Number.isFinite(ts) && ts >= start.getTime() && ts < end.getTime();
      });
      if (trades.length > 0) {
        const pnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
        const startBal = p?.starting_balance ?? 10000;
        rows.push({
          bot,
          realized_pnl: pnl,
          return_pct: startBal > 0 ? (pnl / startBal) * 100 : null,
          activity_count: trades.length,
          equity: p?.equity ?? null,
        });
      }
    } catch (e) {
      console.error(`[daily-snapshot] ${bot} failed:`, e instanceof Error ? e.message : e);
    }
  }

  // ── crypto — order count only (no realized_pnl concept) ────────────────────
  try {
    const orders = await db
      .select({ n: sql<number>`count(*)` })
      .from(ai_trade_orders)
      .where(
        and(
          eq(ai_trade_orders.user_id, userId),
          gte(ai_trade_orders.created_at, start),
          lt(ai_trade_orders.created_at, end),
        ),
      );
    const n = Number(orders[0]?.n ?? 0);
    if (n > 0) {
      rows.push({ bot: "crypto", realized_pnl: null, return_pct: null, activity_count: n, equity: null });
    }
  } catch (e) {
    console.error("[daily-snapshot] crypto failed:", e instanceof Error ? e.message : e);
  }

  return rows;
}

/** Upsert one completed UTC day's per-bot rows for a user. Returns rows written. */
export async function writeDailySnapshot(
  userId: string,
  day: Date,
  source: "snapshot" | "backfill" = "snapshot",
): Promise<number> {
  const { dayStr } = utcDayWindow(day);
  const rows = await computeDailyRows(userId, day);
  for (const r of rows) {
    await db
      .insert(daily_pnl)
      .values({
        user_id: userId,
        day: dayStr,
        bot: r.bot,
        realized_pnl: r.realized_pnl == null ? null : r.realized_pnl.toFixed(2),
        return_pct: r.return_pct == null ? null : r.return_pct.toFixed(4),
        activity_count: r.activity_count,
        equity: r.equity == null ? null : r.equity.toFixed(2),
        source,
      })
      .onConflictDoUpdate({
        target: [daily_pnl.user_id, daily_pnl.day, daily_pnl.bot],
        set: {
          realized_pnl: r.realized_pnl == null ? null : r.realized_pnl.toFixed(2),
          return_pct: r.return_pct == null ? null : r.return_pct.toFixed(4),
          activity_count: r.activity_count,
          equity: r.equity == null ? null : r.equity.toFixed(2),
          source,
        },
      });
  }
  return rows.length;
}
