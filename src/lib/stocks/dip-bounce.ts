import "server-only";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Dip-Bounce read layer. The ranked scan is produced by the Python pipeline
 * (quant-scrap/dipbounce/scanner.py) and written to market_data_cache under
 * "dipbounce:v1". The page + API only read the cached snapshot — Python owns
 * the refresh cadence (daily via Task Scheduler).
 */

const DIP_CACHE_KEY = "dipbounce:v1";

export type DipRow = {
  symbol: string;
  name: string;
  price: number;
  drop_pct: number;          // % below recent high (negative)
  dip_signal_pct: number;    // % vs 20d MA (negative = stretched below)
  bounce_score: number;      // 0..100
  bounce_probability: number; // 0..1
  deep_dip: boolean;
  high_bounce: boolean;
  rsi: number;
  vol_ratio: number;
  ma20: number;
  ma50: number;
  near_support: boolean;
};

export type DipResult = {
  generatedAt: string;
  universe: number;
  passed: number;
  rows: DipRow[];
};

export async function getDipResult(): Promise<DipResult | null> {
  const r = await db
    .select()
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, DIP_CACHE_KEY))
    .limit(1);
  if (r.length === 0) return null;
  const p = r[0].payload as DipResult;
  return Array.isArray(p?.rows) ? p : null;
}
