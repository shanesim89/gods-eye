"use client";

import type { Directive } from "@/lib/council/directive";
import type { VerdictType } from "@/lib/council/types";
import { directiveColor, fmtLevel, HUD } from "@/lib/council/display";
import { ConfidenceGauge } from "./ConfidenceGauge";

// Shared HUD presentation of a resolved Directive. Presentational only — accepts a
// fully-resolved Directive so the resolver can run server-side (AI-portfolio) or
// client-side (CouncilCard). Reused by GURU + every AI-portfolio card.
export function DirectiveCard({
  directive,
  currency,
  variant = "full",
  showConfidence = false,
  confidence,
  verdict,
  bandText,
  showLevels,
}: {
  directive: Directive;
  currency?: string;
  variant?: "full" | "compact";
  showConfidence?: boolean;
  confidence?: number;
  verdict?: VerdictType;
  bandText?: string; // band-for-your-situation explanation, shown under oneLiner
  showLevels?: boolean; // force entry/target/stop grid even when held (defaults to !held)
}) {
  const color = directiveColor(directive.tone);
  const { stance, headline, oneLiner, triggerPrice, entry, stop, target, pnlContext, held } = directive;

  if (variant === "compact") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color, background: `${color}18`, border: `1px solid ${color}55`, padding: "2px 7px", textTransform: "uppercase" }}>
          {stance}
        </span>
        <span style={{ fontSize: 10, color: HUD.text, lineHeight: 1.4 }}>{oneLiner}</span>
      </div>
    );
  }

  const cell = (label: string, value: string, c: string = HUD.text): React.ReactNode => (
    <div key={label} style={{ border: "1px solid rgba(64,200,224,.12)", background: "rgba(70,224,245,.02)", padding: "6px 8px" }}>
      <div style={{ fontSize: 7, letterSpacing: 1, color: HUD.dim, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: c, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );

  return (
    <div
      style={{
        position: "relative", background: "rgba(8,18,28,.6)", border: `1px solid ${color}44`,
        clipPath: "polygon(0 12px,12px 0,calc(100% - 12px) 0,100% 12px,100% calc(100% - 12px),calc(100% - 12px) 100%,12px 100%,0 calc(100% - 12px))",
        padding: "12px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1.5, color, textShadow: `0 0 10px ${color}66` }}>{stance}</span>
            <span style={{ fontSize: 9, color: HUD.dim, textTransform: "uppercase", letterSpacing: 1 }}>
              {held ? "you hold this" : "no position"}
            </span>
          </div>
          <div style={{ fontSize: 11, color: HUD.amber, letterSpacing: 0.5, marginBottom: 2 }}>{headline}</div>
          <div style={{ fontSize: 11, color: HUD.text, lineHeight: 1.5 }}>{oneLiner}</div>
          {bandText && (
            <div style={{ fontSize: 9, color: HUD.dim, lineHeight: 1.5, marginTop: 3, fontStyle: "italic" }}>{bandText}</div>
          )}
          {pnlContext && (
            <div style={{ fontSize: 9, color: HUD.dim, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{pnlContext}</div>
          )}
        </div>
        {showConfidence && confidence != null && (
          <ConfidenceGauge confidence={confidence} color={verdict ? color : color} size={52} />
        )}
      </div>

      {triggerPrice != null && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid rgba(64,200,224,.1)", paddingTop: 8 }}>
          <span style={{ fontSize: 8, letterSpacing: 1, color: HUD.dim, textTransform: "uppercase" }}>Act at</span>
          <span style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{fmtLevel(triggerPrice, currency)}</span>
        </div>
      )}

      {(showLevels ?? !held) && (entry || stop || target) && (
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {cell("ENTRY", entry ? `${fmtLevel(entry.low, currency)}–${fmtLevel(entry.high, currency)}` : "—", HUD.amber)}
          {cell("TARGET", target ? `${fmtLevel(target.low, currency)}–${fmtLevel(target.high, currency)}` : "—", HUD.bull)}
          {cell("STOP", stop != null ? fmtLevel(stop, currency) : "—", HUD.bear)}
        </div>
      )}
    </div>
  );
}
