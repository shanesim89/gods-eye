import type { Verdict } from "@/lib/council/types";

export type BuyZoneResult = {
  isBuyZone: boolean;
  dipDepthPct: number | null; // null when no entry zone; 0..100+ otherwise
  reason: string;
};

// "Clear buy-zone" = council says BUY with conviction AND price has fallen into
// (or below) the recommended entry zone. dipDepthPct measures how deep into the
// zone price sits: 0% at entry.high, 100% at entry.low, >100% below entry.low.
export function evaluateBuyZone(
  verdict: Verdict | null,
  currentPrice: number,
  minConfidence: number
): BuyZoneResult {
  if (!verdict) {
    return { isBuyZone: false, dipDepthPct: null, reason: "no verdict" };
  }
  const levels = verdict.tradeLevels;
  const dipDepthPct = computeDipDepth(levels?.entry, currentPrice);

  if (verdict.verdict !== "BUY") {
    return { isBuyZone: false, dipDepthPct, reason: `verdict ${verdict.verdict}` };
  }
  if (verdict.confidence < minConfidence) {
    return {
      isBuyZone: false,
      dipDepthPct,
      reason: `confidence ${verdict.confidence} < ${minConfidence}`,
    };
  }
  if (!levels?.entry || !(currentPrice > 0)) {
    return { isBuyZone: false, dipDepthPct, reason: "no entry levels" };
  }
  if (currentPrice > levels.entry.high) {
    return {
      isBuyZone: false,
      dipDepthPct,
      reason: `price ${currentPrice} above entry.high ${levels.entry.high}`,
    };
  }
  return { isBuyZone: true, dipDepthPct, reason: "BUY + price in entry zone" };
}

// 0% at entry.high → 100% at entry.low → >100% below entry.low. Null if no zone.
export function computeDipDepth(
  entry: { low: number; high: number } | undefined,
  currentPrice: number
): number | null {
  if (!entry || !(currentPrice > 0)) return null;
  const span = entry.high - entry.low;
  if (!(span > 0)) return null;
  return ((entry.high - currentPrice) / span) * 100;
}

// Order size: boosted when in buy-zone, baseline otherwise.
export function orderAmountUsd(
  isBuyZone: boolean,
  dcaAmount: number,
  boostAmount: number
): { amount: number; boosted: boolean } {
  return isBuyZone
    ? { amount: boostAmount, boosted: true }
    : { amount: dcaAmount, boosted: false };
}
