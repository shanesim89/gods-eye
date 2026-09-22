import "server-only";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { eq } from "drizzle-orm";
import sp500 from "@/data/sp500-constituents.json";

type Constituent = { symbol: string; sector: string };
const CONSTITUENTS = sp500 as Constituent[];

const KEY = process.env.FINNHUB_API_KEY;
const TTL_24HR = 24 * 60 * 60 * 1000;
// Best-effort sample — scanning all 500 daily against Finnhub's free-tier rate
// limit isn't viable, so we sample a fixed rotating subset large enough to be
// directionally meaningful.
const SAMPLE_SIZE = 60;

async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T | null>): Promise<T | null> {
  const rows = await db.select().from(market_data_cache).where(eq(market_data_cache.ticker, key)).limit(1);
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

export type EarningsSnapshot = {
  computedAt: string;
  sampleSize: number;
  covered: number;
  revisedUp: number;
  revisedDown: number;
  pctRevisedUp: number;
  dataQuality: "OK" | "DATA_LIMITED";
};

type TrendResp = {
  data?: Array<{ period: string; epsTrend?: { "7daysAgo"?: number; "30daysAgo"?: number; current?: number } }>;
};

async function fetchOne(symbol: string): Promise<"up" | "down" | "flat" | null> {
  if (!KEY) return null;
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/eps-trend?symbol=${encodeURIComponent(symbol)}&token=${KEY}`,
      { cache: "no-store" },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as TrendResp;
    const q = j.data?.[0]?.epsTrend;
    if (!q || q.current == null || q["30daysAgo"] == null) return null;
    const delta = q.current - q["30daysAgo"];
    if (delta > 0.001) return "up";
    if (delta < -0.001) return "down";
    return "flat";
  } catch {
    return null;
  }
}

/** Best-effort forward-EPS revision breadth across a rotating S&P sample. */
async function computeEarnings(): Promise<EarningsSnapshot | null> {
  if (!KEY) return null;
  const dayIdx = Math.floor(Date.now() / TTL_24HR) % Math.ceil(CONSTITUENTS.length / SAMPLE_SIZE);
  const sample = CONSTITUENTS.slice(dayIdx * SAMPLE_SIZE, dayIdx * SAMPLE_SIZE + SAMPLE_SIZE);
  let up = 0,
    down = 0,
    covered = 0;
  const CONCURRENCY = 8;
  for (let i = 0; i < sample.length; i += CONCURRENCY) {
    const batch = sample.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((c) => fetchOne(c.symbol)));
    for (const r of results) {
      if (!r) continue;
      covered++;
      if (r === "up") up++;
      else if (r === "down") down++;
    }
  }
  return {
    computedAt: new Date().toISOString(),
    sampleSize: sample.length,
    covered,
    revisedUp: up,
    revisedDown: down,
    pctRevisedUp: covered ? Math.round((up / covered) * 1000) / 10 : 0,
    dataQuality: covered >= sample.length * 0.3 ? "OK" : "DATA_LIMITED",
  };
}

export async function getEarningsSnapshot(): Promise<EarningsSnapshot | null> {
  return cached("mstress:earnings", TTL_24HR, computeEarnings);
}
