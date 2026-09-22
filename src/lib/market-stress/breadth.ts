import "server-only";
import sp500 from "@/data/sp500-constituents.json";
import { getYahooData } from "@/lib/yahoo";

type Constituent = { symbol: string; sector: string };
const CONSTITUENTS = sp500 as Constituent[];

export type BreadthSnapshot = {
  computedAt: string; // ISO
  universeSize: number;
  scanned: number;
  pctAbove200dma: number;
  pctAbove50dma: number;
  newHighs: number;
  newLows: number;
  advancers: number;
  decliners: number;
};

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

const CONCURRENCY = 10;

/** Batches Yahoo daily-bar fetches across the full S&P 500, concurrency-limited. */
export async function computeBreadth(): Promise<BreadthSnapshot> {
  let above200 = 0,
    above50 = 0,
    newHigh = 0,
    newLow = 0,
    up = 0,
    down = 0,
    scanned = 0;

  for (let i = 0; i < CONSTITUENTS.length; i += CONCURRENCY) {
    const batch = CONSTITUENTS.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((c) => getYahooData(c.symbol, 260)));
    for (const d of results) {
      if (!d || !d.candles.c.length) continue;
      scanned++;
      const closes = d.candles.c;
      const price = d.price;
      const ma200 = sma(closes, 200);
      const ma50 = sma(closes, 50);
      if (ma200 != null && price > ma200) above200++;
      if (ma50 != null && price > ma50) above50++;
      if (d.week52High != null && price >= d.week52High) newHigh++;
      if (d.week52Low != null && price <= d.week52Low) newLow++;
      if (d.changePct > 0) up++;
      else if (d.changePct < 0) down++;
    }
  }

  return {
    computedAt: new Date().toISOString(),
    universeSize: CONSTITUENTS.length,
    scanned,
    pctAbove200dma: scanned ? Math.round((above200 / scanned) * 1000) / 10 : 0,
    pctAbove50dma: scanned ? Math.round((above50 / scanned) * 1000) / 10 : 0,
    newHighs: newHigh,
    newLows: newLow,
    advancers: up,
    decliners: down,
  };
}
