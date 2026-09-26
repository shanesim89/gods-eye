import "server-only";
// Real market data for the quarterly report — page 2's market pulse, page 5's
// opportunity sparklines, and page 6's benchmark table. Pulls off the
// existing Yahoo layer (src/lib/yahoo.ts) already used elsewhere in gods-eye —
// no new data vendor, and the model never invents a number here.
import { getYahooData } from "@/lib/yahoo";
import { scrapeUrl } from "./firecrawl";
import { FUND_SCRAPES } from "./sources";
import {
  FUND_KEYS,
  type ChartSymbolKey,
  type FundDistributionV2,
  type FundKey,
  type IndexHeatmapEntryV2,
  type OutlookStreamEventV2,
  type ScrapedSource,
  type VixGaugeDataV2,
  type YieldCurvePointV2,
} from "./types";

export type MarketPulseOutcome = "Positive" | "Mixed" | "Stable" | "Negative";

export type MarketPulseArea = {
  label: string;
  symbol: string;
  changePct: number | null;
  outcome: MarketPulseOutcome;
};

type SeriesResult = { symbol: string; closes: number[]; last: number | null; changePct: number | null };

async function fetchSeries(symbol: string, days = 95): Promise<SeriesResult> {
  try {
    const data = await getYahooData(symbol, days);
    const closes = data?.candles?.c ?? [];
    if (closes.length < 2) return { symbol, closes: [], last: null, changePct: null };
    const start = closes[0];
    const end = closes[closes.length - 1];
    const changePct = start > 0 ? ((end - start) / start) * 100 : null;
    return { symbol, closes, last: end, changePct };
  } catch {
    return { symbol, closes: [], last: null, changePct: null };
  }
}

function classify(changePct: number | null): MarketPulseOutcome {
  if (changePct == null) return "Stable";
  if (changePct >= 3) return "Positive";
  if (changePct <= -3) return "Negative";
  if (Math.abs(changePct) < 1) return "Stable";
  return "Mixed";
}

const PULSE_AREAS: { label: string; symbol: string }[] = [
  { label: "Global shares", symbol: "^GSPC" },
  { label: "Asian shares", symbol: "AAXJ" },
  { label: "Global bonds", symbol: "AGG" },
  { label: "Gold", symbol: "GC=F" },
];

/** Quarter-over-quarter % change for the four page-2 market-pulse areas. */
export async function getMarketPulse(): Promise<MarketPulseArea[]> {
  const results = await Promise.all(
    PULSE_AREAS.map(async ({ label, symbol }) => {
      const s = await fetchSeries(symbol);
      return { label, symbol, changePct: s.changePct, outcome: classify(s.changePct) };
    })
  );
  return results;
}

// Maps the model's chart_symbol_key choice (page 5) to a real Yahoo symbol.
const CHART_SYMBOL_MAP: Record<ChartSymbolKey, { symbol: string; label: string }> = {
  AGG: { symbol: "AGG", label: "US investment-grade bond ETF, past quarter" },
  VYM: { symbol: "VYM", label: "High-dividend equity ETF, past quarter" },
  AAXJ: { symbol: "AAXJ", label: "Asia ex-Japan equities, past quarter" },
  SPX: { symbol: "^GSPC", label: "S&P 500, past quarter" },
  GOLD: { symbol: "GC=F", label: "Gold, past quarter" },
};

export async function getChartSeries(key: ChartSymbolKey): Promise<{ closes: number[]; changePct: number | null; label: string }> {
  const { symbol, label } = CHART_SYMBOL_MAP[key];
  const s = await fetchSeries(symbol);
  return { closes: s.closes, changePct: s.changePct, label };
}

// ── Page-5 "macro backdrop" — real-data variants ────────────────────────────
// Only fetched when pickMacroBackdropType() lands on the matching type (see
// stream/route.ts) — no wasted Yahoo calls for the other five types.

const INDEX_HEATMAP_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^STI", label: "Singapore STI" },
  { symbol: "^N225", label: "Nikkei 225" },
  { symbol: "^HSI", label: "Hang Seng" },
  { symbol: "^STOXX50E", label: "Euro Stoxx 50" },
];

/** Regional equity index quarter-to-date % change. */
export async function getIndexHeatmap(): Promise<IndexHeatmapEntryV2[]> {
  return Promise.all(
    INDEX_HEATMAP_SYMBOLS.map(async ({ symbol, label }) => {
      const s = await fetchSeries(symbol);
      return { symbol, label, changePct: s.changePct ?? 0 };
    })
  );
}

// ^IRX/^FVX/^TNX/^TYX all quote directly in yield-percent already (confirmed
// live: ^TNX regularMarketPrice ≈ 4.5-4.7 during 2026, not 45-47) — no /10
// conversion needed. No clean Yahoo ticker exists for a 2Y constant-maturity
// yield, so this is a 4-tenor curve, not 5.
const YIELD_CURVE_SYMBOLS: { tenor: string; symbol: string }[] = [
  { tenor: "3M", symbol: "^IRX" },
  { tenor: "5Y", symbol: "^FVX" },
  { tenor: "10Y", symbol: "^TNX" },
  { tenor: "30Y", symbol: "^TYX" },
];

/** US Treasury yield curve snapshot. */
export async function getYieldCurve(): Promise<YieldCurvePointV2[]> {
  return Promise.all(
    YIELD_CURVE_SYMBOLS.map(async ({ tenor, symbol }) => {
      const s = await fetchSeries(symbol);
      return { tenor, symbol, yieldPct: s.last ?? 0 };
    })
  );
}

/** VIX reading mapped to a low/neutral/elevated/high gauge band. */
export async function getVixGauge(): Promise<VixGaugeDataV2> {
  const s = await fetchSeries("^VIX");
  const value = s.last ?? 18;
  const level = value < 15 ? "low" : value < 25 ? "neutral" : value < 35 ? "elevated" : "high";
  return { value, level };
}

export type BenchmarkRow = { label: string; price: string; changePct: number | null; url: string | null };

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function yahooQuoteUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

// ── Page-4 fund distributions ───────────────────────────────────────────────
// Deterministic, regex-based extraction of the distribution yield + frequency
// from each fund's scraped dealer/factsheet markdown. NEVER model-generated —
// `verified` is only true when the number actually matched in the source, so
// the UI can badge it with confidence instead of a blanket "UNVERIFIED".

function firstMatch(md: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = md.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractDistribution(md: string): FundDistributionV2 {
  // FSMOne dealer pages: "Dividend Yield (%)  6.80%"; GreatLink: "12-month yield
  // ![](<Base64-Image-Removed>) **3.30%**" — the base64 alt-text carries stray
  // digits ("64"), so match the bolded value specifically, not the first digit.
  const yieldStr = firstMatch(md, [
    /Dividend Yield \(%\)\s*\**\s*([\d.]+)\s*%/i,
    /12-month yield[\s\S]{0,60}?\*\*\s*([\d.]+)\s*%/i,
    /12-month yield[\s\S]{0,60}?([\d.]+)\s*%/i,
  ]);
  // FSMOne: "Dividend Frequency  Monthly"; GreatLink: "Distribution frequency **Annually**".
  const freqStr = firstMatch(md, [
    /Dividend Frequency\s*\**\s*(Monthly|Quarterly|Semi-Annually|Annually)/i,
    /Distribution frequency\s*\**\s*(Monthly|Quarterly|Semi-Annually|Annually)/i,
  ]);
  // Quarter (3-month) price/NAV return — FSMOne's "Annualised Returns" panel:
  // "1 WK​-0.07%1 MTH​0.99%3 MTH​5.27%6 MTH…" (zero-width space, no separators
  // between entries); GreatLink's "Performance" list: "3 months4.96%".
  const quarterStr = firstMatch(md, [
    /3\s*MTH[^\d-]{0,20}(-?[\d.]+)\s*%/i,
    /3\s*months?[^\d-]{0,20}(-?[\d.]+)\s*%/i,
  ]);
  const yieldPct = yieldStr ? Number(yieldStr) : null;
  const quarterChangePct = quarterStr ? Number(quarterStr) : null;
  const frequency = freqStr ? freqStr[0].toUpperCase() + freqStr.slice(1).toLowerCase() : null;
  return {
    yieldPct: Number.isFinite(yieldPct) ? yieldPct : null,
    frequency,
    verified: yieldPct != null,
    quarterChangePct: Number.isFinite(quarterChangePct) ? quarterChangePct : null,
  };
}

const EMPTY_DISTRIBUTION: FundDistributionV2 = { yieldPct: null, frequency: null, verified: false, quarterChangePct: null };

/** Parse the 4 fund distributions from the already-gathered scraped sources.
 *  Matches each FUND_SCRAPES entry to its ScrapedSource by name. */
export function parseFundDistributions(sources: ScrapedSource[]): Record<FundKey, FundDistributionV2> {
  const out = Object.fromEntries(FUND_KEYS.map((k) => [k, EMPTY_DISTRIBUTION])) as Record<FundKey, FundDistributionV2>;
  for (const scrape of FUND_SCRAPES) {
    const src = sources.find((s) => s.name === scrape.name && s.ok && s.markdown);
    if (src?.markdown) out[scrape.key] = extractDistribution(src.markdown);
  }
  return out;
}

// A fund's numbers count as "resolved" once its factsheet actually yielded a
// distribution yield AND a quarter price move — a scrape that only found one
// of the two is still worth retrying rather than shipping a half-blank card.
function isResolved(d: FundDistributionV2): boolean {
  return d.verified && d.quarterChangePct != null;
}

const FUND_RETRY_MAX_ATTEMPTS = 3; // 1 initial (already done) + up to 2 retries
const FUND_RETRY_DELAY_MS = 2500;

/** Takes the distributions already parsed from the initial scrape and
 *  re-scrapes+re-extracts any fund that's missing a yield or a quarter move,
 *  up to FUND_RETRY_MAX_ATTEMPTS total attempts per fund. Runs its own
 *  timed rounds — call this in parallel with Claude drafting (Promise.all)
 *  so retries are "free" wall-clock time rather than adding to the pipeline. */
export async function resolveFundDistributions(
  sources: ScrapedSource[],
  emit: (e: OutlookStreamEventV2) => void
): Promise<Record<FundKey, FundDistributionV2>> {
  const dist = parseFundDistributions(sources);

  for (let attempt = 2; attempt <= FUND_RETRY_MAX_ATTEMPTS; attempt++) {
    const pending = FUND_SCRAPES.filter((s) => !isResolved(dist[s.key]));
    if (pending.length === 0) break;

    emit({
      type: "fund_retry",
      keys: pending.map((s) => s.key),
      names: pending.map((s) => s.name),
      attempt,
      maxAttempts: FUND_RETRY_MAX_ATTEMPTS,
    });
    await new Promise((resolve) => setTimeout(resolve, FUND_RETRY_DELAY_MS));

    const results = await Promise.allSettled(
      pending.map(async (s) => {
        const src = await scrapeUrl(s.name, s.url, s.waitForMs ?? 0);
        return [s.key, src.markdown ? extractDistribution(src.markdown) : EMPTY_DISTRIBUTION] as const;
      })
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const key = pending[i].key;
      if (r.status === "fulfilled") {
        dist[key] = r.value[1];
        emit({ type: "source_done", name: pending[i].name, ok: r.value[1].verified });
      } else {
        emit({ type: "source_done", name: pending[i].name, ok: false });
      }
    }
  }

  return dist;
}

/** Page-6 benchmark summary table — real quarter-end levels + moves. */
export async function getBenchmarks(): Promise<BenchmarkRow[]> {
  const [spx, aaxj, tnx, gold, usdsgd] = await Promise.all([
    fetchSeries("^GSPC"),
    fetchSeries("AAXJ"),
    fetchSeries("^TNX"),
    fetchSeries("GC=F"),
    fetchSeries("SGD=X"),
  ]);
  return [
    { label: "S&P 500", price: spx.last != null ? fmt(spx.last) : "—", changePct: spx.changePct, url: yahooQuoteUrl("^GSPC") },
    { label: "MSCI Asia ex-Japan (AAXJ)", price: aaxj.last != null ? fmt(aaxj.last, 2) : "—", changePct: aaxj.changePct, url: yahooQuoteUrl("AAXJ") },
    { label: "US 10-Year Treasury yield", price: tnx.last != null ? `${tnx.last.toFixed(2)}%` : "—", changePct: null, url: yahooQuoteUrl("^TNX") },
    { label: "Gold (per oz)", price: gold.last != null ? `US$${fmt(gold.last)}` : "—", changePct: gold.changePct, url: yahooQuoteUrl("GC=F") },
    { label: "USD/SGD", price: usdsgd.last != null ? fmt(usdsgd.last, 3) : "—", changePct: usdsgd.changePct, url: yahooQuoteUrl("SGD=X") },
  ];
}
