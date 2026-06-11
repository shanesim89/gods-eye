"use client";

import { confidenceBand } from "@/lib/council/display";

// Donut confidence gauge. The labeled BAND is the primary signal (center);
// the raw number is shown small + muted beneath. Extracted from the 3 copies
// previously inlined in CouncilCard / HudCard / OptionCard.
export function ConfidenceGauge({
  confidence,
  color,
  size = 56,
}: {
  confidence: number;
  color: string;
  size?: number;
}) {
  const c = Math.max(0, Math.min(100, Math.round(confidence)));
  const R = 30;
  const CIRC = 2 * Math.PI * R;
  const dash = CIRC * (c / 100);
  const gap = CIRC - dash;
  const band = confidenceBand(c);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={R} fill="none" stroke="rgba(70,224,245,.12)" strokeWidth="6" />
        <circle
          cx="40" cy="40" r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`} transform="rotate(-90 40 40)"
          style={{ filter: `drop-shadow(0 0 4px ${color}99)` }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
        <span style={{ fontSize: size * 0.16, fontWeight: 700, letterSpacing: 0.5, color, fontFamily: "monospace" }}>{band}</span>
        <span style={{ fontSize: size * 0.13, color: "#5b7d8a", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{c}%</span>
      </div>
    </div>
  );
}
