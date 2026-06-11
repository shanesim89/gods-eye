// Pure display helpers shared by the GURU CouncilCard and every AI-portfolio card.
// No React / no server-only imports — safe in both client and server components.

import type { VerdictType } from "./types";

// Canonical HUD palette (cyan/amber aesthetic). Adopted everywhere to kill the
// 4 copy-pasted verdict-color maps.
export const HUD = {
  bull: "#27f59b",
  bear: "#ff5470",
  neutral: "#ffcf4a",
  caution: "#ff9500",
  cyan: "#46e0f5",
  amber: "#ffcf4a",
  dim: "#5b7d8a",
  text: "#bfe9f2",
  faint: "#365360",
} as const;

export type DirectiveTone = "bullish" | "bearish" | "neutral" | "caution";

// Council verdict → color.
export function verdictColor(v: VerdictType | string | null | undefined): string {
  return v === "BUY" ? HUD.bull : v === "SELL" ? HUD.bear : HUD.neutral;
}

// Resolved-directive tone → color.
export function directiveColor(tone: DirectiveTone): string {
  switch (tone) {
    case "bullish": return HUD.bull;
    case "bearish": return HUD.bear;
    case "caution": return HUD.caution;
    default: return HUD.neutral;
  }
}

// Confidence bands — the labeled band is the primary signal; the raw number is secondary.
// The action gate (≥55) is intentionally distinct from the display bands.
export const CONFIDENCE_BANDS = [
  { max: 49, label: "AVOID" },
  { max: 64, label: "LEAN" },
  { max: 79, label: "MODERATE" },
  { max: 100, label: "STRONG" },
] as const;

export function confidenceBand(confidence: number): string {
  const c = Math.max(0, Math.min(100, Math.round(confidence)));
  return (CONFIDENCE_BANDS.find((b) => c <= b.max) ?? CONFIDENCE_BANDS[CONFIDENCE_BANDS.length - 1]).label;
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", SGD: "S$", EUR: "€", GBP: "£", JPY: "¥" };

export function currencySymbol(currency?: string | null): string {
  return CURRENCY_SYMBOL[(currency ?? "USD").toUpperCase()] ?? "";
}

// Format a price level for display. Adapts decimals to magnitude (sub-$1 needs more).
export function fmtLevel(v: number | null | undefined, currency?: string | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sym = currencySymbol(currency);
  const dec = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 1 ? 2 : 4;
  return `${sym}${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}
