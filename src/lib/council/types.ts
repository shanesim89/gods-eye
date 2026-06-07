export type AssetClass = "stocks" | "etf" | "crypto" | "options";
export type Signal = "bull" | "bear" | "neutral";
export type VerdictType = "BUY" | "HOLD" | "SELL";

export type AgentResult = {
  role: string;
  thesis: string;
  signal: Signal;
  confidence: number; // 0–100
  keyPoints: string[];
};

export type PriceRange = { low: number; high: number };

export type TradeLevels = {
  entry: PriceRange;        // zone to open position
  target: PriceRange;       // T1 (low) → T2 (high) take-profit zone
  stopLoss: number;         // single hard stop price
  buyTrigger?: number;      // HOLD only: re-evaluate BUY below this
  sellTrigger?: number;     // HOLD only: re-evaluate SELL above this
  rationale: string;        // 1-sentence why these levels
};

export type LaymanExplanation = {
  action: string;            // "Buy now in small size" / "Wait — don't buy yet" / "Sell or trim"
  why: string[];             // 3 plain-English reasons, no jargon
  whenToReconsider: string;  // "Sell if price drops below $145" — mirrors a tradeLevels number
  whatToWatch: string[];     // 1–2 plain-English risks
};

export type Verdict = {
  verdict: VerdictType;
  confidence: number; // 0–100
  summary: string;
  agents: AgentResult[];
  generatedAt: string;
  tradeLevels?: TradeLevels | null; // null/undefined for legacy cached rows
  currency?: string; // ISO code; legacy rows omit -> default USD
  laymanExplanation?: LaymanExplanation | null; // null/undefined for legacy rows
  aggregateRankings?: AggregateRanking[]; // peer-review rankings; absent for legacy cached rows
};

export type PeerRanking = {
  reviewerRole: string;
  rankedOrder: string[];                  // roles ordered best→worst
  reasoning: Record<string, string>;      // role → 1-sentence reason
};

export type AggregateRanking = {
  role: string;
  avgRank: number;    // 1.0 = best, 5.0 = worst
  topVotes: number;   // count of peers who ranked this #1
};

export type StreamEvent =
  | { type: "agent_start"; role: string }
  | { type: "agent_done"; result: AgentResult }
  | { type: "stage2_start" }
  | { type: "stage2_peer_done"; reviewerRole: string; rankedOrder: string[] }
  | { type: "stage2_complete"; aggregateRankings: AggregateRanking[] }
  | { type: "synth_start" }
  | { type: "verdict"; data: Verdict }
  | { type: "error"; message: string };

export type CouncilContext = {
  ticker: string;
  assetClass: AssetClass;
  price: number;
  changePct: number;
  currency: string; // ISO code, e.g. "USD", "SGD"
  // Equity/ETF fields
  profile?: {
    name: string;
    exchange: string;
    industry: string;
    marketCap: number;
    country: string;
  } | null;
  financials?: Record<string, number | undefined> | null;
  candles?: { dates: string[]; closes: number[]; volumes: number[] } | null;
  news?: { headline: string; source: string; datetime: number }[] | null;
  // Crypto fields
  cryptoMeta?: {
    name: string;
    marketCap: number;
    volume24h: number;
    change7d: number;
    change30d: number;
    circulatingSupply: number;
    maxSupply: number | null;
    athChangePct: number;
    description: string;
  } | null;
  // Options fields
  optionsMeta?: {
    underlying: string;
    optionType: string;
    strike: string;
    expiry: string;
    underlyingPrice: number;
  } | null;
  // Analyst consensus (stocks/etf via Yahoo quoteSummary)
  analyst?: {
    targetMean: number | null;
    targetHigh: number | null;
    targetLow: number | null;
    upsidePct: number | null;
    rating: string | null;             // "buy" | "hold" | ...
    ratingMean: number | null;          // 1=Strong Buy ... 5=Sell
    ratingCount: number | null;
    sector: string | null;
    industry: string | null;
    trend: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  } | null;
  // Upcoming earnings date (stocks/etf from Yahoo calendarEvents)
  nextEarningsDate?: string | null; // ISO "YYYY-MM-DD" or null
  // LunarCrush sentiment (all classes)
  lunarcrush?: {
    galaxyScore: number | null;
    altRank: number | null;
    socialVolume: number | null;
    sentiment: number | null; // 0–100
  } | null;
  // Kronos foundation-model forecast (stocks/etf/crypto only, null if unavailable)
  kronos?: import("@/lib/kronos").KronosForecast | null;
};
