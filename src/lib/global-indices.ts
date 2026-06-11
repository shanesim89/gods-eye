import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getYahooData, getYahooSummary } from "./yahoo";

export type IndexMetrics = {
  pctVsSMA200: number | null;     // % above/below 200D MA
  ret21: number;                  // ~1M return %
  ret63: number;                  // ~3M return %
  ret126: number;                 // ~6M return %
  ret252: number;                 // ~1Y return %
  retYTD: number;                 // YTD return %
  rsi: number;                    // 14-period RSI
  rangePos: number | null;        // % position in 52w range (0=low, 100=high)
  drawdownFromHigh: number | null;// % below 52w high (≤0)
  vol: number;                    // annualized vol %
  sharpe3M: number | null;        // ret63 / (vol / sqrt(4))
  maSignal: "golden" | "death" | "neutral"; // SMA50 vs SMA200
  rsRank: number | null;          // rank 1–10 by 3M return (populated post-scoring)
};

export type IndexValuation = {
  peTTM: number | null;
  peForward: number | null;
  dividendYield: number | null;
  beta: number | null;
} | null;

export type IndexScore = {
  key: string;
  label: string;
  country: string;
  lat: number;
  lon: number;
  dx: number;
  dy: number;
  score: number | null;
  price: number | null;
  changePct: number | null;
  drivers: string[];
  sub: { trend: number; mom: number; meanRev: number; risk: number } | null;
  metrics: IndexMetrics | null;
  valuation: IndexValuation;
  analysis: string | null; // LLM-generated fund manager commentary (cached 2h)
};

const GLOBAL_INDICES = [
  { key: "SPX",   label: "S&P 500",        symbol: "^GSPC",      lat: 39,   lon: -98,   dx: 0,   dy: 0,   country: "United States",     drivers: ["Apple", "Microsoft", "Nvidia"] },
  { key: "N225",  label: "Nikkei 225",      symbol: "^N225",      lat: 36,   lon: 138,   dx: 0,   dy: 0,   country: "Japan",             drivers: ["Toyota", "Sony", "Tokyo Electron"] },
  { key: "STI",   label: "SGX · STI",       symbol: "^STI",       lat: 1.3,  lon: 103.8, dx: -6,  dy: 14,  country: "Singapore",         drivers: ["DBS", "OCBC", "UOB"] },
  { key: "CSI",   label: "CSI 300",         symbol: "000300.SS",  lat: 35,   lon: 104,   dx: 0,   dy: -10, country: "China",             drivers: ["Kweichow Moutai", "CATL", "Ping An"] },
  { key: "STOXX", label: "STOXX 600",       symbol: "^STOXX",     lat: 50,   lon: 10,    dx: 0,   dy: 0,   country: "Europe",            drivers: ["ASML", "Nestlé", "Novo Nordisk"] },
  { key: "NIFTY", label: "NIFTY 50",        symbol: "^NSEI",      lat: 22,   lon: 79,    dx: 0,   dy: 0,   country: "India",             drivers: ["Reliance", "HDFC Bank", "Infosys"] },
  { key: "ASEAN", label: "FTSE ASEAN40",    symbol: "ASEA",       lat: 5,    lon: 117,   dx: 10,  dy: 18,  country: "SE Asia",           drivers: ["DBS", "Bank Rakyat", "PTT"] },
  { key: "EM",    label: "MSCI EM",         symbol: "EEM",        lat: 8,    lon: 38,    dx: 0,   dy: 0,   country: "Emerging (global)", drivers: ["TSMC", "Tencent", "Samsung"] },
  { key: "WORLD", label: "MSCI World",      symbol: "URTH",       lat: 34,   lon: -34,   dx: 0,   dy: 0,   country: "Developed (global)",drivers: ["Apple", "Microsoft", "Nvidia"] },
  { key: "AXJ",   label: "MSCI Asia exJP",  symbol: "AAXJ",       lat: 24,   lon: 114,   dx: 14,  dy: -2,  country: "Asia ex-Japan",     drivers: ["TSMC", "Tencent", "Samsung"] },
] as const;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const slice = closes.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function rsi14(closes: number[]): number | null {
  const period = 14;
  if (closes.length < period + 1) return null;
  const recent = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const d = recent[i] - recent[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + (gains / period) / (losses / period));
}

function annualizedVol(closes: number[]): number {
  const recent = closes.slice(-31);
  if (recent.length < 2) return 20;
  const rets: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1] > 0) rets.push(Math.log(recent[i] / recent[i - 1]));
  }
  if (rets.length < 2) return 20;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252) * 100;
}

function retN(closes: number[], n: number): number {
  const lb = Math.min(n, closes.length - 1);
  const start = closes[closes.length - 1 - lb];
  const end = closes[closes.length - 1];
  return start > 0 ? ((end - start) / start) * 100 : 0;
}

function retYTDFn(closes: number[], timestamps: number[]): number {
  if (!timestamps.length || closes.length !== timestamps.length) return 0;
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime() / 1000; // Unix seconds
  let ytdIdx = -1;
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] >= yearStart) { ytdIdx = i; break; }
  }
  if (ytdIdx < 0) return 0;
  const startClose = closes[ytdIdx];
  const endClose = closes[closes.length - 1];
  return startClose > 0 ? ((endClose - startClose) / startClose) * 100 : 0;
}

function scoreIndex(
  closes: number[],
  timestamps: number[],
  price: number,
  week52High: number | null,
  week52Low: number | null
): { trend: number; mom: number; meanRev: number; risk: number; composite: number; metrics: IndexMetrics } | null {
  if (closes.length < 30) return null;

  // ── Trend (30%): dist from SMA200 ──
  const s200 = sma(closes, Math.min(200, closes.length));
  const pctVsSMA200 = s200 ? ((price - s200) / s200) * 100 : null;
  const trendRaw = s200 ? clamp01(0.5 + (price - s200) / s200 * 2.5) : 0.5;
  const trend = Math.round(trendRaw * 100);

  // ── Momentum (25%): 63-day return ──
  const ret63 = retN(closes, 63);
  const lb63 = Math.min(63, closes.length - 1);
  const start63 = closes[closes.length - 1 - lb63];
  const momRaw = start63 > 0 ? clamp01(0.5 + (price - start63) / start63 * 2) : 0.5;
  const mom = Math.round(momRaw * 100);

  // ── Mean-reversion (25%): RSI blend + 52w range ──
  const rsiVal = rsi14(closes) ?? 50;
  const rsiScore = clamp01((120 - 1.4 * rsiVal) / 100);
  let rangeScore = 0.5;
  let rangePos: number | null = null;
  if (week52High && week52Low && week52High > week52Low) {
    rangePos = ((price - week52Low) / (week52High - week52Low)) * 100;
    rangeScore = clamp01(1 - (price - week52Low) / (week52High - week52Low));
  }
  const meanRev = Math.round((rsiScore * 0.5 + rangeScore * 0.5) * 100);

  // ── Risk (20%): annualized vol ──
  const vol = annualizedVol(closes);
  const risk = Math.round(clamp01((100 - (vol - 10) * 2.5) / 100) * 100);

  const composite = Math.round(0.30 * trend + 0.25 * mom + 0.25 * meanRev + 0.20 * risk);

  // ── Extended metrics ──
  const ret21  = retN(closes, 21);
  const ret126 = retN(closes, 126);
  const ret252 = retN(closes, 252);
  const retYTD = retYTDFn(closes, timestamps);

  const drawdownFromHigh = week52High && week52High > 0
    ? ((price - week52High) / week52High) * 100
    : null;

  const sharpe3M = vol > 0 ? ret63 / (vol / Math.sqrt(4)) : null;

  const sma50 = sma(closes, Math.min(50, closes.length));
  let maSignal: "golden" | "death" | "neutral" = "neutral";
  if (sma50 != null && s200 != null) {
    maSignal = sma50 > s200 ? "golden" : sma50 < s200 ? "death" : "neutral";
  }

  return {
    trend, mom, meanRev, risk, composite,
    metrics: {
      pctVsSMA200,
      ret21, ret63, ret126, ret252, retYTD,
      rsi: rsiVal,
      rangePos,
      drawdownFromHigh,
      vol,
      sharpe3M,
      maSignal,
      rsRank: null, // populated post-scoring
    },
  };
}

// ── LLM analysis helpers ─────────────────────────────────────────────────
const TTL_2HR = 2 * 60 * 60 * 1000;

async function cachedText(key: string, fetcher: () => Promise<string | null>): Promise<string | null> {
  try {
    const rows = await db.select().from(market_data_cache).where(eq(market_data_cache.ticker, key)).limit(1);
    if (rows.length > 0) {
      const age = Date.now() - new Date(rows[0].fetched_at).getTime();
      if (age < TTL_2HR) return (rows[0].payload as { text?: string }).text ?? null;
    }
    const data = await fetcher();
    if (data != null) {
      await db
        .insert(market_data_cache)
        .values({ ticker: key, payload: { text: data }, fetched_at: new Date() })
        .onConflictDoUpdate({
          target: market_data_cache.ticker,
          set: { payload: { text: data }, fetched_at: new Date() },
        });
    }
    return data;
  } catch {
    return null;
  }
}

function verdictLabel(s: number): string {
  if (s >= 62) return "OVERWEIGHT";
  if (s >= 55) return "CONSTRUCTIVE";
  if (s >= 45) return "NEUTRAL";
  if (s >= 38) return "UNDERWEIGHT";
  return "REDUCE";
}

async function generateMarketAnalysis(score: IndexScore): Promise<string | null> {
  if (score.score == null || !score.metrics) return null;
  const cacheKey = `ghm:analysis:${score.key}`;
  const scoreVal = score.score!;
  return cachedText(cacheKey, async () => {
    const m = score.metrics!;
    const val = score.valuation;
    const rsiTag = m.rsi < 35 ? "oversold" : m.rsi > 65 ? "stretched" : "neutral";
    const volTag = m.vol < 15 ? "low" : m.vol > 30 ? "high" : "moderate";
    const maStr = m.maSignal === "golden" ? "golden cross" : m.maSignal === "death" ? "death cross" : "neutral MA configuration";

    const valParts: string[] = [];
    if (val?.peTTM != null)       valParts.push(`P/E ${val.peTTM.toFixed(1)}×`);
    if (val?.peForward != null)   valParts.push(`Fwd P/E ${val.peForward.toFixed(1)}×`);
    if (val?.dividendYield != null) valParts.push(`Div ${val.dividendYield.toFixed(1)}%`);
    if (val?.beta != null)        valParts.push(`Beta ${val.beta.toFixed(2)}`);
    const valLine = valParts.length ? `\n- Valuation: ${valParts.join(" | ")}` : "";

    const prompt = `You are a senior portfolio manager writing a market intelligence brief.

Market: ${score.label} (${score.country}) — Score: ${scoreVal}/100 (${verdictLabel(scoreVal)})

Metrics:
- Returns: 1M ${m.ret21.toFixed(1)}% | 3M ${m.ret63.toFixed(1)}% | 6M ${m.ret126.toFixed(1)}% | YTD ${m.retYTD.toFixed(1)}% | 1Y ${m.ret252.toFixed(1)}%
- Trend: ${m.pctVsSMA200 != null ? m.pctVsSMA200.toFixed(1) + "% vs 200D MA" : "200D MA unavailable"} | ${maStr}
- RSI: ${m.rsi.toFixed(0)} (${rsiTag}) | DD: ${m.drawdownFromHigh != null ? m.drawdownFromHigh.toFixed(1) + "% from 52w high" : "N/A"}
- Vol: ${m.vol.toFixed(0)}% annualized (${volTag}) | Sharpe (3M): ${m.sharpe3M != null ? m.sharpe3M.toFixed(1) : "N/A"}${valLine}

Write 3–4 sentences in fund manager voice. Cover: (1) trend and momentum signal, (2) fundamental valuation context if available, (3) sentiment and risk reading, (4) investment call. Max 65 words. No bullet points. No first-person pronouns. Direct market commentary only.`;

    try {
      const client = new Anthropic();
      const res = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 160,
        messages: [{ role: "user", content: prompt }],
      });
      const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : null;
      return text ?? null;
    } catch {
      return null;
    }
  });
}

export async function getGlobalIndexScores(): Promise<IndexScore[]> {
  const results = await Promise.allSettled(
    GLOBAL_INDICES.map(async (idx) => {
      const [ydRes, summRes] = await Promise.allSettled([
        getYahooData(idx.symbol, 365),
        getYahooSummary(idx.symbol),
      ]);
      const yd = ydRes.status === "fulfilled" ? ydRes.value : null;
      const summ = summRes.status === "fulfilled" ? summRes.value : null;

      const valuation: IndexValuation = summ ? {
        peTTM: summ.peTTM,
        peForward: summ.peForward,
        dividendYield: summ.dividendYield,
        beta: summ.beta,
      } : null;

      if (!yd) {
        return {
          key: idx.key, label: idx.label, country: idx.country,
          lat: idx.lat, lon: idx.lon, dx: idx.dx, dy: idx.dy,
          score: null, price: null, changePct: null,
          drivers: [...idx.drivers], sub: null, metrics: null, valuation, analysis: null,
        };
      }

      const scored = scoreIndex(yd.candles.c, yd.candles.t, yd.price, yd.week52High, yd.week52Low);
      return {
        key: idx.key,
        label: idx.label,
        country: idx.country,
        lat: idx.lat,
        lon: idx.lon,
        dx: idx.dx,
        dy: idx.dy,
        score: scored?.composite ?? null,
        price: yd.price,
        changePct: yd.changePct,
        drivers: [...idx.drivers],
        sub: scored ? { trend: scored.trend, mom: scored.mom, meanRev: scored.meanRev, risk: scored.risk } : null,
        metrics: scored?.metrics ?? null,
        valuation,
        analysis: null, // populated below
      };
    })
  );

  const scores: IndexScore[] = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          key: GLOBAL_INDICES[i].key,
          label: GLOBAL_INDICES[i].label,
          country: GLOBAL_INDICES[i].country,
          lat: GLOBAL_INDICES[i].lat,
          lon: GLOBAL_INDICES[i].lon,
          dx: GLOBAL_INDICES[i].dx,
          dy: GLOBAL_INDICES[i].dy,
          score: null,
          price: null,
          changePct: null,
          drivers: [...GLOBAL_INDICES[i].drivers],
          sub: null,
          metrics: null,
          valuation: null,
          analysis: null,
        }
  );

  // Assign rsRank by 3M return (ret63), descending
  const withMetrics = scores.filter((s) => s.metrics != null);
  withMetrics.sort((a, b) => (b.metrics!.ret63) - (a.metrics!.ret63));
  withMetrics.forEach((s, i) => {
    if (s.metrics) s.metrics.rsRank = i + 1;
  });

  // Generate LLM analysis per market (cached 2h, non-blocking fallback)
  await Promise.allSettled(
    scores.map(async (s) => {
      s.analysis = await generateMarketAnalysis(s);
    })
  );

  return scores;
}
