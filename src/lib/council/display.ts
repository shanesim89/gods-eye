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

// ── Band explanations ────────────────────────────────────────────────────────
// The band name describes signal quality; these lines describe what the band
// means *for the user's situation*. LEAN spans the 55 action gate, so it
// branches: 50–54 reads "below gate", 55–64 reads "tradeable but small edge".

export type BandMode = "flat" | "holding" | "wheel_cash" | "wheel_stock";

const ACTION_GATE_LOCAL = 55; // mirror of directive.ACTION_GATE (avoid import cycle)

const BAND_EXPLANATIONS: Record<string, Record<BandMode, string>> = {
  AVOID: {
    flat: "Do not enter — conviction well below the action gate.",
    holding: "Signal too weak to justify changes — sit tight, no add or trim.",
    wheel_cash: "Too uncertain to sell puts — keep the cash idle this cycle.",
    wheel_stock: "Too uncertain to act — hold shares, skip new calls this cycle.",
  },
  LEAN_BELOW: {
    flat: "Mild tilt but below the action gate — wait for confirmation.",
    holding: "Mild tilt, below the gate — hold; don't add or trim on this alone.",
    wheel_cash: "Mild tilt, below the gate — sell puts only at reduced size, or wait.",
    wheel_stock: "Mild tilt, below the gate — keep existing calls, write nothing new.",
  },
  LEAN_ABOVE: {
    flat: "Tradeable but a small edge — enter only at the stated levels, small size.",
    holding: "Small edge — act only if price hits the trigger; keep size modest.",
    wheel_cash: "Small edge — sell puts at conservative strikes, reduced size.",
    wheel_stock: "Small edge — sell calls further out of the money than usual.",
  },
  MODERATE: {
    flat: "Solid signal — enter at the stated levels with normal size.",
    holding: "Conviction is real — follow the add/trim trigger if price reaches it.",
    wheel_cash: "Solid signal — sell puts at target delta, normal size.",
    wheel_stock: "Solid signal — sell calls at target delta against the shares.",
  },
  STRONG: {
    flat: "High conviction — act at the stated levels; sizing up is justified.",
    holding: "High conviction — execute the directive without hesitation.",
    wheel_cash: "High conviction — sell puts at full size.",
    wheel_stock: "High conviction — run the wheel at full size on this underlying.",
  },
};

export function bandExplanation(confidence: number, mode: BandMode): string {
  const band = confidenceBand(confidence);
  const key = band === "LEAN" ? (confidence >= ACTION_GATE_LOCAL ? "LEAN_ABOVE" : "LEAN_BELOW") : band;
  return BAND_EXPLANATIONS[key]?.[mode] ?? "";
}

// Index-flavored copy for the global radar — no positions exist for indices,
// so the bands read as attractiveness, not trade directives.
const INDEX_BAND_EXPLANATIONS: Record<string, string> = {
  AVOID: "Weak setup — this market scores poorly across factors; look elsewhere.",
  LEAN: "Slight edge — some factors favorable, not enough to overweight.",
  MODERATE: "Attractive — most factors align; reasonable to overweight gradually.",
  STRONG: "Highly attractive — broad factor alignment; a conviction overweight.",
};

export function indexBandExplanation(score: number): string {
  return INDEX_BAND_EXPLANATIONS[confidenceBand(score)] ?? "";
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
