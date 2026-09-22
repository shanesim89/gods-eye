import "server-only";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getYahooData } from "@/lib/yahoo";
import { getFredSeries, fredChangeSet, fredPercentile, type FredSeries } from "./fred";
import { getEarningsSnapshot } from "./earnings";
import type { BreadthSnapshot } from "./breadth";
import {
  type StageResult,
  type IndicatorReading,
  type Status,
  type ChangeSet,
  hyOasStatus,
  nfciStatus,
  breadthStatus,
  vixStatus,
  worstStatus,
  overallScore,
  currentStage,
  riskLevel,
  classifyTrend,
} from "./score";

async function getBreadthCache(): Promise<BreadthSnapshot | null> {
  const rows = await db.select().from(market_data_cache).where(eq(market_data_cache.ticker, "mstress:breadth")).limit(1);
  return rows.length ? (rows[0].payload as BreadthSnapshot) : null;
}

function indicatorFromFred(
  label: string,
  series: FredSeries | null,
  statusFn: (v: number) => Status,
  worseWhenRising: boolean,
): IndicatorReading {
  if (!series) {
    return {
      key: label,
      label,
      value: null,
      prev: null,
      change: { w1: null, m1: null, m3: null },
      status: "YELLOW",
      quality: "UNAVAILABLE",
      percentile: null,
    };
  }
  const cs = fredChangeSet(series);
  const change: ChangeSet = { w1: cs.w1, m1: cs.m1, m3: cs.m3 };
  return {
    key: label,
    label,
    value: cs.latest,
    prev: cs.prev,
    change,
    status: cs.latest != null ? statusFn(cs.latest) : "YELLOW",
    quality: "OK",
    percentile: fredPercentile(series),
  };
}

export type MarketStressState = {
  computedAt: string;
  stages: StageResult[];
  score: number;
  riskLevel: ReturnType<typeof riskLevel>;
  stage: number;
  shockOverride: boolean;
  breadthAsOf: string | null;
  earningsQuality: "OK" | "DATA_LIMITED" | "UNAVAILABLE";
};

export async function getMarketStressState(): Promise<MarketStressState> {
  const [dgs10, dfii10, nfci, hyOas, spx, vix, breadth, earnings] = await Promise.all([
    getFredSeries("DGS10"),
    getFredSeries("DFII10"),
    getFredSeries("NFCI"),
    getFredSeries("BAMLH0A0HYM2"),
    getYahooData("^GSPC", 400),
    getYahooData("^VIX", 90),
    getBreadthCache(),
    getEarningsSnapshot(),
  ]);

  // ── Stage 1: Rates ──────────────────────────────────────────────────────
  const tenY = indicatorFromFred("10Y Treasury yield", dgs10, (v) => (v > 5 ? "ORANGE" : v > 4.5 ? "YELLOW" : "GREEN"), true);
  const realY = indicatorFromFred("10Y real (TIPS) yield", dfii10, (v) => (v > 2.5 ? "ORANGE" : v > 2 ? "YELLOW" : "GREEN"), true);
  const stage1: StageResult = {
    id: 1,
    title: "Rates / cost of money",
    status: worstStatus([tenY.status, realY.status]),
    quality: tenY.quality === "OK" || realY.quality === "OK" ? "OK" : "UNAVAILABLE",
    indicators: [tenY, realY],
  };

  // ── Stage 2: Breadth ────────────────────────────────────────────────────
  const breadthIndicator: IndicatorReading = breadth
    ? {
        key: "pctAbove200dma",
        label: "% of S&P 500 above 200DMA",
        value: breadth.pctAbove200dma,
        prev: null,
        change: { w1: null, m1: null, m3: null },
        status: breadthStatus(breadth.pctAbove200dma),
        quality: "OK",
        percentile: null,
      }
    : {
        key: "pctAbove200dma",
        label: "% of S&P 500 above 200DMA",
        value: null,
        prev: null,
        change: { w1: null, m1: null, m3: null },
        status: "YELLOW",
        quality: "UNAVAILABLE",
        percentile: null,
      };
  const above50Indicator: IndicatorReading | null = breadth
    ? {
        key: "pctAbove50dma",
        label: "% of S&P 500 above 50DMA",
        value: breadth.pctAbove50dma,
        prev: null,
        change: { w1: null, m1: null, m3: null },
        status: breadthStatus(breadth.pctAbove50dma),
        quality: "OK",
        percentile: null,
      }
    : null;
  const stage2Indicators = above50Indicator ? [breadthIndicator, above50Indicator] : [breadthIndicator];
  const stage2: StageResult = {
    id: 2,
    title: "Market breadth",
    status: worstStatus(stage2Indicators.map((i) => i.status)),
    quality: breadth ? "OK" : "UNAVAILABLE",
    indicators: stage2Indicators,
  };

  // ── Stage 3: Credit ─────────────────────────────────────────────────────
  const hyOasIndicator = indicatorFromFred("HY OAS credit spread", hyOas, hyOasStatus, true);
  const stage3: StageResult = {
    id: 3,
    title: "Credit spreads",
    status: hyOasIndicator.status,
    quality: hyOasIndicator.quality,
    indicators: [hyOasIndicator],
  };

  // ── Stage 4: Earnings ───────────────────────────────────────────────────
  const earningsIndicator: IndicatorReading = earnings && earnings.covered > 0
    ? {
        key: "pctRevisedUp",
        label: "% forward EPS revised up (sample)",
        value: earnings.pctRevisedUp,
        prev: null,
        change: { w1: null, m1: null, m3: null },
        status: earnings.pctRevisedUp >= 50 ? "GREEN" : earnings.pctRevisedUp >= 35 ? "YELLOW" : earnings.pctRevisedUp >= 20 ? "ORANGE" : "RED",
        quality: earnings.dataQuality,
        percentile: null,
      }
    : {
        key: "pctRevisedUp",
        label: "% forward EPS revised up (sample)",
        value: null,
        prev: null,
        change: { w1: null, m1: null, m3: null },
        status: "YELLOW",
        quality: "UNAVAILABLE",
        percentile: null,
      };
  const stage4: StageResult = {
    id: 4,
    title: "Earnings revisions",
    status: earningsIndicator.quality === "UNAVAILABLE" ? "YELLOW" : earningsIndicator.status,
    quality: earningsIndicator.quality,
    indicators: [earningsIndicator],
  };

  // ── Stage 5: Long-term trend ────────────────────────────────────────────
  let trendIndicator: IndicatorReading;
  if (spx && spx.candles.c.length >= 200) {
    const closes = spx.candles.c;
    const ma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
    const price = spx.price;
    const pctVs200 = ((price - ma200) / ma200) * 100;
    trendIndicator = {
      key: "spxVs200dma",
      label: "S&P 500 vs 200DMA",
      value: pctVs200,
      prev: null,
      change: { w1: null, m1: null, m3: spx.changePct },
      status: pctVs200 > 3 ? "GREEN" : pctVs200 > 0 ? "YELLOW" : pctVs200 > -5 ? "ORANGE" : "RED",
      quality: "OK",
      percentile: null,
    };
  } else {
    trendIndicator = {
      key: "spxVs200dma",
      label: "S&P 500 vs 200DMA",
      value: null,
      prev: null,
      change: { w1: null, m1: null, m3: null },
      status: "YELLOW",
      quality: "UNAVAILABLE",
      percentile: null,
    };
  }
  const stage5: StageResult = {
    id: 5,
    title: "Long-term trend",
    status: trendIndicator.status,
    quality: trendIndicator.quality,
    indicators: [trendIndicator],
  };

  // ── Stage 6: Forced selling / systemic stress ───────────────────────────
  const vixIndicator: IndicatorReading = vix
    ? {
        key: "vix",
        label: "VIX",
        value: vix.price,
        prev: vix.prevClose,
        change: { w1: null, m1: null, m3: vix.changePct },
        status: vixStatus(vix.price),
        quality: "OK",
        percentile: null,
      }
    : {
        key: "vix",
        label: "VIX",
        value: null,
        prev: null,
        change: { w1: null, m1: null, m3: null },
        status: "YELLOW",
        quality: "UNAVAILABLE",
        percentile: null,
      };
  const nfciIndicator = indicatorFromFred("Chicago Fed NFCI", nfci, nfciStatus, true);
  const stage6Indicators = [vixIndicator, nfciIndicator];
  const stage6: StageResult = {
    id: 6,
    title: "Forced selling / systemic stress",
    status: worstStatus(stage6Indicators.map((i) => i.status)),
    quality: vixIndicator.quality === "OK" || nfciIndicator.quality === "OK" ? "OK" : "UNAVAILABLE",
    indicators: stage6Indicators,
  };

  const stages = [stage1, stage2, stage3, stage4, stage5, stage6];
  const score = overallScore(stages);
  const { stage, shockOverride } = currentStage(stages);

  // Rate-of-change: apply classifyTrend to indicators that carry FRED changes
  // (kept as metadata on the indicator via change set — UI reads classifyTrend directly).
  void classifyTrend;

  return {
    computedAt: new Date().toISOString(),
    stages,
    score,
    riskLevel: riskLevel(score),
    stage,
    shockOverride,
    breadthAsOf: breadth?.computedAt ?? null,
    earningsQuality: earnings?.dataQuality ?? "UNAVAILABLE",
  };
}
