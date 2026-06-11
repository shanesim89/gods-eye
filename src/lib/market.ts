import "server-only";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { eq } from "drizzle-orm";

const FINNHUB = process.env.FINNHUB_API_KEY;
const COINGECKO = process.env.COINGECKO_API_KEY;
const TTL_MS = 10 * 60 * 1000; // 10 min
const HIST_TTL_MS = 60 * 60 * 1000; // 1h — price-history series

export type PriceQuote = {
  price: number;
  currency: string;
  source: "finnhub" | "coingecko" | "cache";
  change_pct?: number | null;
  fetched_at: Date;
};

const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  USDT: "tether",
  BNB: "binancecoin",
  XRP: "ripple",
  USDC: "usd-coin",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  TRX: "tron",
  LINK: "chainlink",
  MATIC: "polygon",
  DOT: "polkadot",
  LTC: "litecoin",
  NEAR: "near",
  UNI: "uniswap",
  ICP: "internet-computer",
  ATOM: "cosmos",
  ETC: "ethereum-classic",
  BCH: "bitcoin-cash",
  FIL: "filecoin",
  XLM: "stellar",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  INJ: "injective-protocol",
  SUI: "sui",
  TON: "the-open-network",
  RNDR: "render-token",
};

function normalizeTicker(raw: string, assetClass: string): string {
  let t = raw.trim().toUpperCase();
  if (assetClass === "crypto") {
    t = t.replace(/-USDT?$/i, "").replace(/USDT?$/i, "");
    if (t === "") t = raw.trim().toUpperCase();
  }
  return t;
}

function cacheKey(assetClass: string, ticker: string, currency: string): string {
  return `${assetClass}:${ticker}:${currency.toUpperCase()}`;
}

async function readCache(key: string): Promise<PriceQuote | null> {
  const r = await db
    .select()
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, key))
    .limit(1);
  if (r.length === 0) return null;
  const row = r[0];
  const age = Date.now() - new Date(row.fetched_at).getTime();
  if (age > TTL_MS) return null;
  const p = row.payload as { price: number; currency: string; change_pct?: number | null };
  return {
    price: Number(p.price),
    currency: p.currency,
    source: "cache",
    change_pct: p.change_pct ?? null,
    fetched_at: new Date(row.fetched_at),
  };
}

async function writeCache(
  key: string,
  payload: { price: number; currency: string; source: string; change_pct?: number | null }
) {
  await db
    .insert(market_data_cache)
    .values({ ticker: key, payload, fetched_at: new Date() })
    .onConflictDoUpdate({
      target: market_data_cache.ticker,
      set: { payload, fetched_at: new Date() },
    });
}

async function fetchFinnhubQuote(symbol: string): Promise<{ price: number; change_pct: number | null } | null> {
  if (!FINNHUB) return null;
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { c?: number; pc?: number };
    if (!j.c || j.c === 0) return null;
    const change_pct = j.pc && j.pc > 0 ? ((j.c - j.pc) / j.pc) * 100 : null;
    return { price: j.c, change_pct };
  } catch {
    return null;
  }
}

async function resolveCoinGeckoId(ticker: string): Promise<string | null> {
  const upper = ticker.toUpperCase();
  if (CRYPTO_IDS[upper]) return CRYPTO_IDS[upper];

  // Cached lookup
  const cacheK = `crypto-id:${upper}`;
  const cached = await db
    .select()
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, cacheK))
    .limit(1);
  if (cached.length > 0) {
    const p = cached[0].payload as { id?: string };
    if (p?.id) return p.id;
  }

  // CoinGecko search
  try {
    const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(upper)}`;
    const headers: Record<string, string> = {};
    if (COINGECKO) headers["x-cg-demo-api-key"] = COINGECKO;
    const r = await fetch(url, { cache: "no-store", headers });
    if (!r.ok) return null;
    const j = (await r.json()) as { coins?: { id: string; symbol: string }[] };
    const match = j.coins?.find((c) => c.symbol?.toUpperCase() === upper) ?? j.coins?.[0];
    if (!match?.id) return null;
    await writeCache(cacheK, { price: 0, currency: "", source: "coingecko-search", change_pct: null });
    // Overwrite with proper payload containing id
    await db
      .insert(market_data_cache)
      .values({ ticker: cacheK, payload: { id: match.id }, fetched_at: new Date() })
      .onConflictDoUpdate({
        target: market_data_cache.ticker,
        set: { payload: { id: match.id }, fetched_at: new Date() },
      });
    return match.id;
  } catch {
    return null;
  }
}

async function fetchCoinGeckoPrice(
  ticker: string,
  vsCurrency: string
): Promise<{ price: number; change_pct: number | null } | null> {
  const id = await resolveCoinGeckoId(ticker);
  if (!id) return null;
  try {
    const vs = vsCurrency.toLowerCase();
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${vs}&include_24hr_change=true`;
    const headers: Record<string, string> = {};
    if (COINGECKO) headers["x-cg-demo-api-key"] = COINGECKO;
    const r = await fetch(url, { cache: "no-store", headers });
    if (!r.ok) return null;
    const j = (await r.json()) as Record<string, Record<string, number>>;
    const entry = j[id];
    if (!entry) return null;
    const price = entry[vs];
    if (typeof price !== "number" || price <= 0) return null;
    const change_pct = entry[`${vs}_24h_change`] ?? null;
    return { price, change_pct };
  } catch {
    return null;
  }
}

/**
 * Fetch live price for a ticker. Returns null for non-tickerable asset classes
 * or when all providers fail.
 */
export async function getPrice(
  ticker: string,
  assetClass: string,
  requestedCurrency = "USD"
): Promise<PriceQuote | null> {
  if (!["equity", "etf", "crypto"].includes(assetClass)) return null;
  if (!ticker || !ticker.trim()) return null;

  const normalized = normalizeTicker(ticker, assetClass);
  const key = cacheKey(assetClass, normalized, requestedCurrency);

  const cached = await readCache(key);
  if (cached) return cached;

  if (assetClass === "equity" || assetClass === "etf") {
    const q = await fetchFinnhubQuote(normalized);
    if (!q) return null;
    await writeCache(key, {
      price: q.price,
      currency: "USD",
      source: "finnhub",
      change_pct: q.change_pct,
    });
    return {
      price: q.price,
      currency: "USD",
      source: "finnhub",
      change_pct: q.change_pct,
      fetched_at: new Date(),
    };
  }

  // crypto
  const q = await fetchCoinGeckoPrice(normalized, requestedCurrency);
  if (!q) return null;
  await writeCache(key, {
    price: q.price,
    currency: requestedCurrency.toUpperCase(),
    source: "coingecko",
    change_pct: q.change_pct,
  });
  return {
    price: q.price,
    currency: requestedCurrency.toUpperCase(),
    source: "coingecko",
    change_pct: q.change_pct,
    fetched_at: new Date(),
  };
}

async function readSeriesCache(key: string): Promise<number[] | null> {
  const r = await db
    .select()
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, key))
    .limit(1);
  if (r.length === 0) return null;
  const row = r[0];
  if (Date.now() - new Date(row.fetched_at).getTime() > HIST_TTL_MS) return null;
  const p = row.payload as { series?: number[] };
  return Array.isArray(p?.series) ? p.series : null;
}

async function writeSeriesCache(key: string, series: number[]) {
  const payload = { series };
  await db
    .insert(market_data_cache)
    .values({ ticker: key, payload, fetched_at: new Date() })
    .onConflictDoUpdate({
      target: market_data_cache.ticker,
      set: { payload, fetched_at: new Date() },
    });
}

/**
 * Fetch daily close prices for a crypto ticker over the last `days` days
 * (CoinGecko market_chart). Cached ~1h. Returns null on failure / non-crypto.
 */
export async function getPriceHistory(
  ticker: string,
  days = 30
): Promise<number[] | null> {
  if (!ticker || !ticker.trim()) return null;
  const normalized = normalizeTicker(ticker, "crypto");
  const cacheK = `crypto-hist:${normalized}:${days}`;

  const cached = await readSeriesCache(cacheK);
  if (cached) return cached;

  const id = await resolveCoinGeckoId(normalized);
  if (!id) return null;
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const headers: Record<string, string> = {};
    if (COINGECKO) headers["x-cg-demo-api-key"] = COINGECKO;
    const r = await fetch(url, { cache: "no-store", headers });
    if (!r.ok) return null;
    const j = (await r.json()) as { prices?: [number, number][] };
    const series = (j.prices ?? [])
      .map(([, p]) => p)
      .filter((p) => typeof p === "number" && Number.isFinite(p));
    if (series.length === 0) return null;
    await writeSeriesCache(cacheK, series);
    return series;
  } catch {
    return null;
  }
}
