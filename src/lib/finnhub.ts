import "server-only";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { eq } from "drizzle-orm";

const KEY = process.env.FINNHUB_API_KEY;
const BASE = "https://finnhub.io/api/v1";

async function get<T>(path: string): Promise<T | null> {
  if (!KEY) return null;
  try {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${BASE}${path}${sep}token=${KEY}`, { cache: "no-store" });
    if (!r.ok) return null;
    return r.json() as Promise<T>;
  } catch {
    return null;
  }
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

export type StockProfile = {
  name: string;
  ticker: string;
  logo: string;
  exchange: string;
  finnhubIndustry: string;
  marketCapitalization: number; // millions USD
  currency: string;
  country: string;
  ipo: string;
  weburl: string;
};

export type StockQuote = {
  c: number;   // current price
  d: number;   // change
  dp: number;  // change percent
  h: number;   // day high
  l: number;   // day low
  o: number;   // open
  pc: number;  // previous close
  t: number;   // timestamp
};

export type BasicMetrics = Record<string, number | undefined>;

export type StockCandles = {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  t: number[];
  v: number[];
  s: string;
};

export type NewsItem = {
  datetime: number;
  headline: string;
  source: string;
  url: string;
  summary: string;
  category: string;
};

const TTL_1MIN  = 60 * 1000;
const TTL_1HR   = 60 * 60 * 1000;
const TTL_15MIN = 15 * 60 * 1000;
const TTL_30MIN = 30 * 60 * 1000;
const TTL_24HR  = 24 * 60 * 60 * 1000;

export async function getProfile(symbol: string): Promise<StockProfile | null> {
  return cached(`fh-profile:${symbol}`, TTL_1HR, () =>
    get<StockProfile>(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`)
  );
}

export async function getQuote(symbol: string): Promise<StockQuote | null> {
  return cached(`fh-quote:${symbol}`, TTL_1MIN, () =>
    get<StockQuote>(`/quote?symbol=${encodeURIComponent(symbol)}`)
  );
}

export async function getBasicFinancials(symbol: string): Promise<BasicMetrics | null> {
  type Raw = { metric?: BasicMetrics };
  return cached(`fh-fin:${symbol}`, TTL_24HR, async () => {
    const r = await get<Raw>(`/stock/basic-financials?symbol=${encodeURIComponent(symbol)}&metric=all`);
    return r?.metric ?? null;
  });
}

export async function getCandles(symbol: string, days = 90): Promise<StockCandles | null> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86400;
  return cached(`fh-candles:${symbol}:${days}`, TTL_15MIN, () =>
    get<StockCandles>(`/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}`)
  );
}

export async function getCompanyNews(symbol: string): Promise<NewsItem[] | null> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
  return cached(`fh-news:${symbol}`, TTL_30MIN, () =>
    get<NewsItem[]>(`/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`)
  );
}
