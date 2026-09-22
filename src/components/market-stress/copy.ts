import type { Status } from "@/lib/market-stress/score";

export const statusColor: Record<Status, string> = {
  GREEN: "text-green",
  YELLOW: "text-amber",
  ORANGE: "text-amber",
  RED: "text-red",
  CRITICAL: "text-red",
};

export const statusDot: Record<Status, string> = {
  GREEN: "bg-green",
  YELLOW: "bg-amber",
  ORANGE: "bg-amber",
  RED: "bg-red",
  CRITICAL: "bg-red",
};

export const statusLabel: Record<Status, string> = {
  GREEN: "Normal",
  YELLOW: "Watch",
  ORANGE: "Elevated",
  RED: "Stressed",
  CRITICAL: "Critical",
};

type IndicatorCopy = { what: string; whyItMatters: string };

// Plain-English explanation + why-it-matters per indicator key. Kept as data
// so StageCard stays a dumb renderer.
export const INDICATOR_COPY: Record<string, IndicatorCopy> = {
  "10Y Treasury yield": {
    what: "The interest rate the US government pays to borrow for 10 years — the benchmark rate most other borrowing costs are priced off of.",
    whyItMatters: "Rising yields raise the cost of money economy-wide, which can slow growth and pressure stock valuations, especially for richly-priced growth companies.",
  },
  "10Y real (TIPS) yield": {
    what: "The 10Y yield after subtracting expected inflation — what lenders actually earn after inflation.",
    whyItMatters: "A rising real yield tightens financial conditions even if inflation is flat, since it directly raises the discount rate used to value future earnings.",
  },
  pctAbove200dma: {
    what: "The share of S&P 500 companies trading above their own 200-day average price.",
    whyItMatters: "A falling percentage means fewer stocks are participating in gains, even if the index itself looks fine — a classic early warning that a rally is narrowing.",
  },
  pctAbove50dma: {
    what: "The share of S&P 500 companies trading above their own 50-day average price — a shorter-term breadth read.",
    whyItMatters: "Short-term breadth turns before long-term breadth. A drop here often precedes weakness in the 200DMA measure.",
  },
  "HY OAS credit spread": {
    what: "The extra yield investors demand to hold high-yield (junk) corporate bonds over safe Treasuries.",
    whyItMatters: "Credit markets are usually smarter and faster than stock markets. Widening spreads mean bond investors are pricing in more default risk — historically one of the most reliable stress signals.",
  },
  pctRevisedUp: {
    what: "The share of a sampled group of S&P 500 companies whose forward earnings estimates were revised up over the last 30 days.",
    whyItMatters: "Analysts revising estimates down across the board signals deteriorating business conditions before it shows up in reported results.",
  },
  spxVs200dma: {
    what: "How far the S&P 500 index itself sits above or below its own 200-day average.",
    whyItMatters: "This is the slowest-moving, most confirmatory signal — by the time this turns negative, deterioration has usually been visible in the earlier stages for a while.",
  },
  vix: {
    what: "The market's implied volatility over the next 30 days, derived from S&P 500 options prices — often called the 'fear gauge'.",
    whyItMatters: "Sharp VIX spikes accompany forced selling and liquidations, not just normal volatility — a rapid jump is more meaningful than the absolute level.",
  },
  "Chicago Fed NFCI": {
    what: "A composite index of financial conditions (credit, leverage, risk) across money markets, debt, and equity markets, from the Chicago Fed.",
    whyItMatters: "Positive and rising values indicate financial conditions are tighter than historical average — a systemic, economy-wide stress signal rather than a single-market one.",
  },
};

export const STAGE_EXPLAINER: Record<number, string> = {
  1: "Higher rates raise the cost of money for everyone, which can slow growth and pressure valuations before it shows up anywhere else.",
  2: "Fewer stocks participating in gains — the rally narrows before the index itself rolls over.",
  3: "Credit investors are pricing in more default risk. Historically among the most reliable early-stress signals.",
  4: "Analysts are cutting forward earnings estimates — a sign the fundamentals softening, not just sentiment.",
  5: "The index itself has broken its own long-term trend — a slower, confirmatory signal.",
  6: "Signs of forced, non-discretionary selling and tightening system-wide financial conditions.",
};

// Never predict a crash: only describe direction and confidence, not timing or magnitude.
export function scoreNarrative(score: number, trendCopy: string): string {
  if (score < 20) return `Conditions broadly normal across the stages tracked here. ${trendCopy}`;
  if (score < 40) return `Some early signs of stress in isolated indicators, nothing broad-based yet. ${trendCopy}`;
  if (score < 60) return `Stress is building across multiple stages. Worth monitoring closely. ${trendCopy}`;
  if (score < 80) return `Multiple stages showing significant stress simultaneously. ${trendCopy}`;
  return `Stress readings are at their most severe across most stages tracked. This does not predict what markets do next — only that current conditions are historically stressed. ${trendCopy}`;
}
