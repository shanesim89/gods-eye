import "server-only";

export type KronosForecast = {
  direction: "up" | "down" | "flat";
  priceDeltaPct: number;   // (mean final predicted close − current close) / current × 100
  sampleStd: number;        // std-dev of final close across samples — uncertainty proxy
  bars: {
    ts: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
};

type OHLCVBar = {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// In-memory cache: key = `${lastBarTs}:${predLen}:${ohlcvLen}`, TTL 6h
// Mirrors the yahooSession cache pattern in yahoo.ts.
const _cache = new Map<string, { data: KronosForecast; fetchedAt: number }>();
const TTL_MS = 6 * 60 * 60 * 1000;

function cacheKey(bars: OHLCVBar[], predLen: number): string {
  const lastTs = bars.at(-1)?.ts ?? "?";
  return `${lastTs}:${predLen}:${bars.length}`;
}

/**
 * Call the Modal Kronos endpoint.
 * Returns null on any failure (timeout, cold-start, missing env var) so
 * council still completes — FORECAST agent emits a neutral stub.
 */
export async function getKronosForecast(args: {
  ohlcv: OHLCVBar[];
  predLen: number;
  samples?: number;
}): Promise<KronosForecast | null> {
  const { ohlcv, predLen, samples = 8 } = args;

  const url = process.env.KRONOS_URL;
  const token = process.env.KRONOS_TOKEN;

  if (!url) {
    // Env not configured — silent null (no crash)
    return null;
  }

  if (ohlcv.length < 10) return null; // not enough bars to forecast

  const key = cacheKey(ohlcv, predLen);
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.data;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12_000); // 12s timeout

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ohlcv, pred_len: predLen, samples }),
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[kronos] endpoint returned HTTP ${res.status}`);
      return null;
    }

    const raw = (await res.json()) as {
      direction?: string;
      price_delta_pct?: number;
      sample_std?: number;
      bars?: OHLCVBar[];
    };

    const direction = raw.direction === "up" || raw.direction === "down" || raw.direction === "flat"
      ? raw.direction
      : "flat";

    const result: KronosForecast = {
      direction,
      priceDeltaPct: typeof raw.price_delta_pct === "number" ? raw.price_delta_pct : 0,
      sampleStd: typeof raw.sample_std === "number" ? raw.sample_std : 0,
      bars: Array.isArray(raw.bars) ? raw.bars : [],
    };

    _cache.set(key, { data: result, fetchedAt: Date.now() });
    return result;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[kronos] request timed out (12s) — likely cold start; returning null");
    } else {
      console.warn("[kronos] fetch error:", err instanceof Error ? err.message : err);
    }
    return null;
  }
}

/**
 * Build the OHLCV bar array from ctx.candles for passing to getKronosForecast.
 * Pads missing volume with 0 (crypto candles sometimes lack volume).
 */
export function candlesToOHLCV(candles: {
  dates: string[];
  closes: number[];
  volumes: number[];
} | null | undefined): OHLCVBar[] {
  if (!candles) return [];
  return candles.dates.map((ts, i) => ({
    ts,
    open: candles.closes[i] ?? 0,   // we only have close/volume from the candle fetch
    high: candles.closes[i] ?? 0,
    low: candles.closes[i] ?? 0,
    close: candles.closes[i] ?? 0,
    volume: candles.volumes[i] ?? 0,
  }));
}
