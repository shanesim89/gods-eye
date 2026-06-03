import "server-only";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { StockCandles } from "./finnhub";

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const SUMMARY_BASE = "https://query1.finance.yahoo.com/v10/finance/quoteSummary";
const SUMMARY_MODULES = "summaryDetail,defaultKeyStatistics,financialData,assetProfile,recommendationTrend";

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
const TTL_6HR = 6 * 60 * 60 * 1000;

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

// ---------------------------------------------------------------------------
// Yahoo quoteSummary (keyless) — fundamentals + analyst data
// ---------------------------------------------------------------------------

export type YahooRecTrend = {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
};

export type YahooSummary = {
  // Valuation
  peTTM: number | null;
  peForward: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  epsTTM: number | null;
  epsForward: number | null;
  beta: number | null;
  // Profitability / leverage
  roe: number | null;            // percent
  roa: number | null;            // percent
  profitMargin: number | null;   // percent
  operatingMargin: number | null; // percent
  debtToEquity: number | null;
  currentRatio: number | null;
  // Income
  dividendYield: number | null;  // percent
  dividendRate: number | null;
  payoutRatio: number | null;    // percent
  // Profile
  sector: string | null;
  industry: string | null;
  longBusinessSummary: string | null;
  // Analyst
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  numberOfAnalystOpinions: number | null;
  recommendationMean: number | null;  // 1=Strong Buy ... 5=Sell
  recommendationKey: string | null;   // "buy" | "hold" | ...
  recommendationTrend: YahooRecTrend[] | null;
};

type RawValue = { raw?: number; fmt?: string } | number | string | null | undefined;

function rawNum(v: RawValue): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && "raw" in v && typeof v.raw === "number" && Number.isFinite(v.raw)) {
    return v.raw;
  }
  return null;
}

function rawStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

type QuoteSummaryResponse = {
  quoteSummary?: {
    result?: Array<{
      summaryDetail?: Record<string, RawValue>;
      defaultKeyStatistics?: Record<string, RawValue>;
      financialData?: Record<string, RawValue>;
      assetProfile?: Record<string, unknown>;
      recommendationTrend?: { trend?: Array<Record<string, RawValue>> };
    }>;
    error?: unknown;
  };
};

// Yahoo's v10 quoteSummary now requires a cookie + crumb pair. We cache both
// in-process; on 401 we refresh once and retry.
let yahooSession: { cookie: string; crumb: string; fetchedAt: number } | null = null;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

async function refreshYahooSession(): Promise<typeof yahooSession> {
  try {
    const seed = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "manual",
      cache: "no-store",
    });
    const setCookie = seed.headers.get("set-cookie");
    if (!setCookie) return null;
    // Reduce Set-Cookie to a Cookie header (name=value pairs).
    const cookie = setCookie
      .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    if (!cookie) return null;
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie },
      cache: "no-store",
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 64) return null;
    yahooSession = { cookie, crumb, fetchedAt: Date.now() };
    return yahooSession;
  } catch {
    return null;
  }
}

async function getYahooSession(): Promise<typeof yahooSession> {
  if (yahooSession && Date.now() - yahooSession.fetchedAt < SESSION_TTL_MS) {
    return yahooSession;
  }
  return refreshYahooSession();
}

async function fetchYahooSummary(symbol: string): Promise<YahooSummary | null> {
  try {
    let sess = await getYahooSession();
    if (!sess) return null;
    const callOnce = async (s: { cookie: string; crumb: string }): Promise<Response> =>
      fetch(
        `${SUMMARY_BASE}/${encodeURIComponent(symbol)}?modules=${SUMMARY_MODULES}&crumb=${encodeURIComponent(s.crumb)}`,
        {
          cache: "no-store",
          headers: { "User-Agent": "Mozilla/5.0", Cookie: s.cookie },
        }
      );
    let r = await callOnce(sess);
    if (r.status === 401 || r.status === 403) {
      const fresh = await refreshYahooSession();
      if (!fresh) return null;
      sess = fresh;
      r = await callOnce(fresh);
    }
    if (!r.ok) return null;
    const j = (await r.json()) as QuoteSummaryResponse;
    const res = j.quoteSummary?.result?.[0];
    if (!res) return null;

    const sd = res.summaryDetail ?? {};
    const ks = res.defaultKeyStatistics ?? {};
    const fd = res.financialData ?? {};
    const ap = res.assetProfile ?? {};
    const rt = res.recommendationTrend?.trend ?? [];

    // Yahoo returns ratios as fractions (0.25 = 25%) for ROE / margins / divYield / payoutRatio.
    const pct = (v: RawValue): number | null => {
      const n = rawNum(v);
      return n == null ? null : n * 100;
    };

    const trend: YahooRecTrend[] = rt
      .map((t) => ({
        period: rawStr(t.period as unknown) ?? "",
        strongBuy: rawNum(t.strongBuy) ?? 0,
        buy: rawNum(t.buy) ?? 0,
        hold: rawNum(t.hold) ?? 0,
        sell: rawNum(t.sell) ?? 0,
        strongSell: rawNum(t.strongSell) ?? 0,
      }))
      .filter((t) => t.period.length > 0);

    return {
      peTTM: rawNum(sd.trailingPE) ?? rawNum(ks.trailingPE),
      peForward: rawNum(sd.forwardPE) ?? rawNum(ks.forwardPE),
      pegRatio: rawNum(ks.pegRatio),
      priceToBook: rawNum(ks.priceToBook),
      priceToSales: rawNum(sd.priceToSalesTrailing12Months),
      epsTTM: rawNum(ks.trailingEps),
      epsForward: rawNum(ks.forwardEps),
      beta: rawNum(sd.beta) ?? rawNum(ks.beta),
      roe: pct(fd.returnOnEquity),
      roa: pct(fd.returnOnAssets),
      profitMargin: pct(fd.profitMargins) ?? pct(ks.profitMargins),
      operatingMargin: pct(fd.operatingMargins),
      debtToEquity: rawNum(fd.debtToEquity),
      currentRatio: rawNum(fd.currentRatio),
      dividendYield: pct(sd.dividendYield),
      dividendRate: rawNum(sd.dividendRate),
      payoutRatio: pct(sd.payoutRatio),
      sector: rawStr(ap.sector),
      industry: rawStr(ap.industry),
      longBusinessSummary: rawStr(ap.longBusinessSummary),
      targetMeanPrice: rawNum(fd.targetMeanPrice),
      targetHighPrice: rawNum(fd.targetHighPrice),
      targetLowPrice: rawNum(fd.targetLowPrice),
      numberOfAnalystOpinions: rawNum(fd.numberOfAnalystOpinions),
      recommendationMean: rawNum(fd.recommendationMean),
      recommendationKey: rawStr(fd.recommendationKey),
      recommendationTrend: trend.length ? trend : null,
    };
  } catch {
    return null;
  }
}

/** Keyless Yahoo quoteSummary snapshot. Cached 6h. */
export async function getYahooSummary(symbol: string): Promise<YahooSummary | null> {
  return cached(`yh:${symbol}:summary`, TTL_6HR, () => fetchYahooSummary(symbol));
}

/**
 * Map a YahooSummary to the Finnhub `BasicMetrics` field names the guru pages
 * + council already read. Keeps consumers unchanged.
 */
export function mergeYahooSummaryAsFinancials(
  s: YahooSummary | null,
  yh?: { week52High?: number | null; week52Low?: number | null } | null
): Record<string, number | undefined> | null {
  if (!s && !yh) return null;
  const out: Record<string, number | undefined> = {};
  if (s?.peTTM != null) out.peNormalizedAnnual = s.peTTM;
  if (s?.epsTTM != null) out.epsTTM = s.epsTTM;
  if (s?.beta != null) out.beta = s.beta;
  if (s?.dividendYield != null) out.dividendYieldIndicatedAnnual = s.dividendYield;
  if (s?.roe != null) out.roeTTM = s.roe;
  if (s?.profitMargin != null) out.netProfitMarginTTM = s.profitMargin;
  if (s?.debtToEquity != null) out.totalDebt_totalEquityQuarterly = s.debtToEquity;
  if (yh?.week52High != null) out["52WeekHigh"] = yh.week52High;
  if (yh?.week52Low != null) out["52WeekLow"] = yh.week52Low;
  return Object.keys(out).length ? out : null;
}
