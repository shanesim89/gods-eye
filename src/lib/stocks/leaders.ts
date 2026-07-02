import "server-only";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Momentum/growth "Leaders" read layer — the opposite lens to dip-bounce.
 * Produced by the Python pipeline (quant-scrap/dipbounce/leaders.py) and written
 * to market_data_cache under "leaders:v1". Read-only here; Python owns refresh.
 */

const LEADERS_CACHE_KEY = "leaders:v1";

export type LeaderRow = {
  symbol: string;
  name: string;
  price: number;
  mom_12_1: number;          // 12-1 month return %
  near_high_pct: number;     // % from 52wk high (<=0)
  rs_spy: number;            // 6mo relative strength vs SPY (pts)
  ma_stack: boolean;         // Stage-2: price>MA50>MA200, MA50 rising
  rsi: number;
  momentum_score: number;    // 0..100
  growth_score: number;      // 0..100
  growth_available: boolean;
  revenue_growth: number | null;  // % YoY
  earnings_growth: number | null; // % YoY
  profit_margin: number | null;   // %
  peg: number | null;
  leader_score: number;      // 0..100 blended
  tag: "EARLY" | "EXTENDED";
};

export type LeaderResult = {
  generatedAt: string;
  universe: number;
  passed: number;
  rows: LeaderRow[];
};

export async function getLeadersResult(): Promise<LeaderResult | null> {
  const r = await db
    .select()
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, LEADERS_CACHE_KEY))
    .limit(1);
  if (r.length === 0) return null;
  const p = r[0].payload as LeaderResult;
  return Array.isArray(p?.rows) ? p : null;
}
