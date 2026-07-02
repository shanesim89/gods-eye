import "server-only";

/**
 * Trend-Spotting field schema. The natural-language theme parser
 * (`parse.ts`) is constrained to these fields only — any field the LLM emits
 * that is not listed here is rejected server-side, so the screen can never
 * filter on a metric we don't actually have.
 *
 * Field keys map 1:1 to the row shapes produced by the existing universe
 * pipelines: `ScoredCoin` (crypto scanner), `LeaderRow` (stock leaders),
 * `DipRow` (dip-bounce). `run.ts` reads these fields off each row.
 */

export type AssetClass = "crypto" | "stocks";

export type FieldType = "number" | "bool" | "enum";

export type FieldDef = {
  /** Dotted path into the universe row, e.g. "dims.momentum". */
  key: string;
  label: string;
  type: FieldType;
  /** Higher is more bullish (true) / lower is more bullish (false) / n/a (null). */
  higherIsBetter: boolean | null;
  desc: string;
  /** Allowed values for enum fields. */
  values?: string[];
};

/** Crypto universe = ScoredCoin (src/lib/crypto/scanner.ts). */
const CRYPTO_FIELDS: FieldDef[] = [
  { key: "pct24h", label: "24h %", type: "number", higherIsBetter: true, desc: "Price change over 24h, percent." },
  { key: "pct7d", label: "7d %", type: "number", higherIsBetter: true, desc: "Price change over 7d, percent." },
  { key: "pct30d", label: "30d %", type: "number", higherIsBetter: true, desc: "Price change over 30d, percent." },
  { key: "dims.momentum", label: "Momentum score", type: "number", higherIsBetter: true, desc: "0-100 volume-ignition momentum signal." },
  { key: "dims.runway", label: "Upside runway", type: "number", higherIsBetter: true, desc: "0-100 distance-from-ATH recovery potential, only when turning up." },
  { key: "dims.stealth", label: "Stealth accumulation", type: "number", higherIsBetter: true, desc: "0-100 rising-volume-flat-price (Wyckoff) signal." },
  { key: "dims.liquidity", label: "Liquidity quality", type: "number", higherIsBetter: true, desc: "0-100; peaks in the $10M-$500M mcap sweet spot." },
  { key: "athChangePct", label: "% from ATH", type: "number", higherIsBetter: null, desc: "Percent below all-time high (negative)." },
  { key: "upsideMultiple", label: "Upside to ATH (x)", type: "number", higherIsBetter: true, desc: "Multiple needed to reclaim ATH." },
  { key: "mcap", label: "Market cap $", type: "number", higherIsBetter: null, desc: "Market capitalization in USD." },
  { key: "volMcap", label: "Vol/Mcap", type: "number", higherIsBetter: true, desc: "24h volume normalized by market cap." },
  { key: "rank", label: "Mcap rank", type: "number", higherIsBetter: false, desc: "Market-cap rank (1 = largest)." },
  { key: "socialSurge", label: "Social surge", type: "bool", higherIsBetter: true, desc: "LunarCrush social-velocity spike flag." },
  { key: "galaxyScore", label: "Galaxy score", type: "number", higherIsBetter: true, desc: "LunarCrush composite social/market score (may be null)." },
  { key: "riskTier", label: "Risk tier", type: "enum", higherIsBetter: null, desc: "Liquidity/quality tier.", values: ["speculative", "high", "medium", "low"] },
  { key: "buckets", label: "Bucket", type: "enum", higherIsBetter: null, desc: "Classification tags (array contains).", values: ["MOONSHOT", "BREAKOUT", "STEALTH", "SOCIAL"] },
];

/**
 * Stocks universe = LeaderRow (momentum/growth) ∪ DipRow (mean-reversion).
 * `source` picks which pipeline a field comes from; run.ts merges by symbol.
 */
const STOCK_FIELDS: (FieldDef & { source: "leaders" | "dip" })[] = [
  { source: "leaders", key: "mom_12_1", label: "12-1 momentum %", type: "number", higherIsBetter: true, desc: "12-month return excluding most recent month, percent." },
  { source: "leaders", key: "near_high_pct", label: "% from 52w high", type: "number", higherIsBetter: true, desc: "Percent below 52-week high (<=0; closer to 0 = stronger)." },
  { source: "leaders", key: "rs_spy", label: "RS vs SPY", type: "number", higherIsBetter: true, desc: "6-month relative strength vs SPY, points." },
  { source: "leaders", key: "ma_stack", label: "Stage-2 uptrend", type: "bool", higherIsBetter: true, desc: "Price>MA50>MA200 with MA50 rising." },
  { source: "leaders", key: "rsi", label: "RSI", type: "number", higherIsBetter: null, desc: "14-day RSI." },
  { source: "leaders", key: "revenue_growth", label: "Revenue growth %", type: "number", higherIsBetter: true, desc: "YoY revenue growth, percent (may be null)." },
  { source: "leaders", key: "earnings_growth", label: "Earnings growth %", type: "number", higherIsBetter: true, desc: "YoY earnings growth, percent (may be null)." },
  { source: "leaders", key: "profit_margin", label: "Profit margin %", type: "number", higherIsBetter: true, desc: "Net profit margin, percent (may be null)." },
  { source: "leaders", key: "peg", label: "PEG", type: "number", higherIsBetter: false, desc: "Price/earnings-to-growth (may be null)." },
  { source: "leaders", key: "momentum_score", label: "Momentum score", type: "number", higherIsBetter: true, desc: "0-100 blended momentum." },
  { source: "leaders", key: "growth_score", label: "Growth score", type: "number", higherIsBetter: true, desc: "0-100 blended growth." },
  { source: "leaders", key: "leader_score", label: "Leader score", type: "number", higherIsBetter: true, desc: "0-100 blended momentum+growth." },
  { source: "leaders", key: "tag", label: "Trend stage", type: "enum", higherIsBetter: null, desc: "Position in the trend.", values: ["EARLY", "EXTENDED"] },
  { source: "dip", key: "drop_pct", label: "Drop from high %", type: "number", higherIsBetter: null, desc: "Percent below recent high (negative)." },
  { source: "dip", key: "dip_signal_pct", label: "Stretch vs 20d MA %", type: "number", higherIsBetter: null, desc: "Percent vs 20d MA (negative = stretched below)." },
  { source: "dip", key: "bounce_score", label: "Bounce score", type: "number", higherIsBetter: true, desc: "0-100 mean-reversion bounce setup." },
  { source: "dip", key: "bounce_probability", label: "Bounce probability", type: "number", higherIsBetter: true, desc: "0-1 modeled bounce probability." },
  { source: "dip", key: "near_support", label: "Near support", type: "bool", higherIsBetter: true, desc: "Price near a support level." },
];

export const SCHEMA: Record<AssetClass, FieldDef[]> = {
  crypto: CRYPTO_FIELDS,
  stocks: STOCK_FIELDS,
};

export function stockFieldSource(key: string): "leaders" | "dip" | null {
  const f = STOCK_FIELDS.find((x) => x.key === key);
  return f ? f.source : null;
}

/**
 * Concepts we deliberately DON'T have data for. The parser is told to put any
 * sub-criterion that needs one of these into `unmet[]` rather than inventing a
 * field — surfaced honestly in the UI as "data unavailable".
 */
export const UNAVAILABLE: string[] = [
  "insider buying / Form 4 transactions",
  "institutional / hedge-fund holdings (13F / 13D)",
  "short interest / borrow / days-to-cover (stocks)",
  "earnings-call transcript tone or guidance",
  "analyst estimate revisions / 'ahead of consensus' positioning",
  "options flow / unusual options activity",
  "sell-side price-target changes",
];

/** Valid field keys for an asset class, for server-side validation. */
export function validKeys(assetClass: AssetClass): Set<string> {
  return new Set(SCHEMA[assetClass].map((f) => f.key));
}
