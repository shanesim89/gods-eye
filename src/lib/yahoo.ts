import "server-only";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { StockCandles } from "./finnhub";

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

export type YahooData = {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  price: number;
  prevClose: number | null;
  changePct: number;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  week52High: number | null;
  week52Low: number | null;
  volume: number | null;
  candles: StockCandles; // Finnhub-compatible shape
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: Record<string, unknown>;
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: unknown;
  };
};

const TTL_15MIN = 15 * 60 * 1000;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T | null>
): Promise<T | null> {
  const rows = await db
    .select()
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, key))
    .limit(1);
  if (rows.length > 0) {
    const age = Date.now() - new Date(rows[0].fetched_at).getTime();
    if (age < ttlMs) return rows[0].payload as T;
  }
  const data = await fetcher();
  if (data != null) {
    await db
      .insert(market_data_cache)
      .values({ ticker: key, payload: data as Record<string, unknown>, fetched_at: new Date() })
      .onConflictDoUpdate({
        target: market_data_cache.ticker,
        set: { payload: data as Record<string, unknown>, fetched_at: new Date() },
      });
  }
  return data;
}

async function fetchYahoo(symbol: string, days: number): Promise<YahooData | null> {
  // Yahoo accepts range tokens; map days → nearest supported range
  const range = days <= 5 ? "5d" : days <= 30 ? "1mo" : days <= 90 ? "3mo" : days <= 180 ? "6mo" : "1y";
  try {
    const r = await fetch(
      `${CHART_BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=1d`,
      { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!r.ok) return null;
    const j = (await r.json()) as YahooChartResponse;
    const res = j.chart?.result?.[0];
    if (!res?.meta) return null;
    const meta = res.meta;
    const q = res.indicators?.quote?.[0] ?? {};
    const ts = res.timestamp ?? [];

    // Build Finnhub-compatible candles, dropping null bars
    const c: number[] = [], h: number[] = [], l: number[] = [], o: number[] = [], v: number[] = [], t: number[] = [];
    for (let i = 0; i < ts.length; i++) {
      const close = q.close?.[i];
      if (close == null || !Number.isFinite(close)) continue;
      c.push(close);
      h.push(q.high?.[i] ?? close);
      l.push(q.low?.[i] ?? close);
      o.push(q.open?.[i] ?? close);
      v.push(q.volume?.[i] ?? 0);
      t.push(ts[i]);
    }
    const candles: StockCandles = { c, h, l, o, v, t, s: c.length ? "ok" : "no_data" };

    const price = num(meta.regularMarketPrice) ?? (c.length ? c[c.length - 1] : 0);
    const prevClose = num(meta.chartPreviousClose) ?? num(meta.previousClose);
    const changePct = prevClose && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

    return {
      symbol: String(meta.symbol ?? symbol),
      name: (meta.longName as string) ?? (meta.shortName as string) ?? null,
      currency: (meta.currency as string) ?? null,
      exchange: (meta.fullExchangeName as string) ?? (meta.exchangeName as string) ?? null,
      price,
      prevClose,
      changePct,
      open: o.length ? o[o.length - 1] : null,
      dayHigh: num(meta.regularMarketDayHigh),
      dayLow: num(meta.regularMarketDayLow),
      week52High: num(meta.fiftyTwoWeekHigh),
      week52Low: num(meta.fiftyTwoWeekLow),
      volume: num(meta.regularMarketVolume),
      candles,
    };
  } catch {
    return null;
  }
}

/** Full Yahoo snapshot (price + 52w + candles) for a symbol. Cached 15min. */
export async function getYahooData(symbol: string, days = 90): Promise<YahooData | null> {
  return cached(`yh:${symbol}:${days}`, TTL_15MIN, () => fetchYahoo(symbol, days));
}

/** Finnhub-compatible candles via Yahoo. */
export async function getYahooCandles(symbol: string, days = 90): Promise<StockCandles | null> {
  const d = await getYahooData(symbol, days);
  return d?.candles ?? null;
}
