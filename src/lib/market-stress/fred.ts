import "server-only";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { eq } from "drizzle-orm";

const KEY = process.env.FRED_API_KEY;
const BASE = "https://api.stlouisfed.org/fred/series/observations";
const TTL_6HR = 6 * 60 * 60 * 1000;

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

export type FredPoint = { date: string; value: number };
export type FredSeries = { seriesId: string; points: FredPoint[] };

async function fetchFredSeries(seriesId: string): Promise<FredSeries | null> {
  if (!KEY) return null;
  try {
    const url = `${BASE}?series_id=${encodeURIComponent(seriesId)}&api_key=${KEY}&file_type=json&sort_order=desc&limit=400`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { observations?: Array<{ date: string; value: string }> };
    const points: FredPoint[] = (j.observations ?? [])
      .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
      .filter((p) => Number.isFinite(p.value));
    return points.length ? { seriesId, points } : null;
  } catch {
    return null;
  }
}

/** Latest ~400 daily/weekly observations for a FRED series, newest first. Cached 6h. */
export async function getFredSeries(seriesId: string): Promise<FredSeries | null> {
  return cached(`fred:${seriesId}`, TTL_6HR, () => fetchFredSeries(seriesId));
}

/** Latest value + values ~1w/1m/3m ago (nearest available observation). */
export function fredChangeSet(series: FredSeries): {
  latest: number | null;
  prev: number | null;
  w1: number | null;
  m1: number | null;
  m3: number | null;
} {
  const pts = series.points; // newest first
  if (!pts.length) return { latest: null, prev: null, w1: null, m1: null, m3: null };
  const latest = pts[0].value;
  const prev = pts[1]?.value ?? null;
  const nearestBefore = (days: number): number | null => {
    const targetTime = new Date(pts[0].date).getTime() - days * 86400_000;
    let best: FredPoint | null = null;
    for (const p of pts) {
      const t = new Date(p.date).getTime();
      if (t <= targetTime) {
        best = p;
        break;
      }
    }
    return best?.value ?? null;
  };
  const w1v = nearestBefore(7);
  const m1v = nearestBefore(30);
  const m3v = nearestBefore(90);
  return {
    latest,
    prev,
    w1: w1v != null ? latest - w1v : null,
    m1: m1v != null ? latest - m1v : null,
    m3: m3v != null ? latest - m3v : null,
  };
}

/** Percentile rank (0-100) of the latest value within the fetched history. */
export function fredPercentile(series: FredSeries): number | null {
  const pts = series.points;
  if (pts.length < 20) return null;
  const latest = pts[0].value;
  const sorted = pts.map((p) => p.value).sort((a, b) => a - b);
  const idx = sorted.findIndex((v) => v >= latest);
  return Math.round((idx / (sorted.length - 1)) * 100);
}
