"use client";

import { useState } from "react";
import type { Verdict } from "@/lib/council/types";
import { resolveDirective } from "@/lib/council/directive";
import { bandExplanation, verdictColor as vColor } from "@/lib/council/display";
import { ConfidenceGauge } from "@/components/council/ConfidenceGauge";
import { DirectiveCard } from "@/components/council/DirectiveCard";

export type OptionCardRow = {
  underlying: string;
  assetClass: string;
  spot: number | null;
  changePct: number | null;
  verdict: Verdict | null;
  wheelState: "cash" | "holding_stock";
  shares: number;
  costBasis: number | null; // per share
  nextRun: Date | null;
  openPositions: OpenPosition[];
  totalPremiumIncome: number; // realized premium collected (all-time)
  totalRealizedPnl: number;
  collateralReserved: number;
  // strategy settings for the plan line
  targetDelta: number;
  dteMin: number;
  dteMax: number;
};

export type OpenPosition = {
  id: string;
  strategy: string;
  contractSymbol: string;
  strike: number;
  expiry: Date;
  dte: number;
  optType: "C" | "P";
  entryPremium: number;
  premiumTotal: number;
  delta: number | null;
  theta: number | null;
  side: string;
};

function usd(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

function strategyLabel(strategy: string): string {
  const map: Record<string, string> = {
    csp: "CASH-SECURED PUT",
    cc: "COVERED CALL",
    long_call: "LONG CALL",
    long_put: "LONG PUT",
  };
  return map[strategy] ?? strategy.toUpperCase();
}

function plainEnglish(pos: OpenPosition, underlying: string): string {
  const exp = fmtDate(pos.expiry);
  const strike = usd(pos.strike, pos.strike >= 100 ? 0 : 2);
  const prem = usd(pos.premiumTotal, 0);
  if (pos.strategy === "csp")
    return `Sold ${strike} put · collected ${prem}. If ${underlying} < ${strike} on ${exp}, you buy 100 shares @ ${strike}.`;
  if (pos.strategy === "cc")
    return `Sold ${strike} call · collected ${prem}. If ${underlying} > ${strike} on ${exp}, shares called away at ${strike}.`;
  if (pos.strategy === "long_call")
    return `Bought ${strike} call · paid ${prem}. Profit if ${underlying} rises above ${strike} by ${exp}.`;
  return `Bought ${strike} put · paid ${prem}. Profit if ${underlying} falls below ${strike} by ${exp}.`;
}

export function OptionCard({ row }: { row: OptionCardRow }) {
  const { underlying, spot, changePct, verdict, wheelState, shares, costBasis, nextRun,
    openPositions, totalPremiumIncome, totalRealizedPnl, collateralReserved,
    targetDelta, dteMin, dteMax } = row;

  const [showExplain, setShowExplain] = useState(false);
  const conf = verdict?.confidence ?? 0;
  const verdictColor = vColor(verdict?.verdict);

  // Wheel-aware directive (sell puts in cash, sell calls when holding).
  const directive = verdict
    ? resolveDirective({
        verdict: verdict.verdict,
        confidence: verdict.confidence,
        tradeLevels: verdict.tradeLevels,
        currentPrice: spot,
        position: { kind: "wheel", state: wheelState, shares, costBasisPerShare: costBasis },
        venue: "wheel",
      })
    : null;

  const stateLabel = wheelState === "cash" ? "CASH · SELLING PUTS" : `HOLDING ${Math.round(shares)} · SELLING CALLS`;
  const stateColor = wheelState === "cash" ? "#27f59b" : "#ffcf4a";

  // Forward plan line — what the wheel intends next and the contract spec it will use.
  const planLine =
    wheelState === "cash"
      ? `STATE: CASH → NEXT: SELL PUT @ Δ${targetDelta}, ${dteMin}–${dteMax} DTE`
      : `STATE: HOLDING ${Math.round(shares)} → NEXT: SELL CALL @ Δ${targetDelta}, ${dteMin}–${dteMax} DTE${costBasis != null ? ` above basis ${usd(costBasis, 2)}` : ""}`;

  const premiumAtRisk = openPositions.reduce((s, p) => s + p.premiumTotal, 0);

  const cellStyle: React.CSSProperties = {
    border: "1px solid rgba(64,200,224,.12)", padding: "6px 8px",
    background: "rgba(70,224,245,.02)",
    clipPath: "polygon(0 0,calc(100% - 5px) 0,100% 5px,100% 100%,5px 100%,0 calc(100% - 5px))",
  };

  return (
    <div style={{
      position: "relative", background: "rgba(8,18,28,.6)",
      border: "1px solid rgba(64,200,224,.22)",
      clipPath: "polygon(0 14px,14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px))",
      backdropFilter: "blur(2px)", display: "flex", flexDirection: "column",
    }}>
      {/* corner brackets */}
      {[
        { top: 5, left: 5, borderTop: "2px solid", borderLeft: "2px solid" },
        { top: 5, right: 5, borderTop: "2px solid", borderRight: "2px solid" },
        { bottom: 5, left: 5, borderBottom: "2px solid", borderLeft: "2px solid" },
        { bottom: 5, right: 5, borderBottom: "2px solid", borderRight: "2px solid" },
      ].map((s, i) => (
        <div key={i} style={{ position: "absolute", width: 16, height: 16, pointerEvents: "none", borderColor: "rgba(70,224,245,.5)", ...s }} />
      ))}

      {/* HEADER */}
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(64,200,224,.15)", background: "linear-gradient(120deg,rgba(255,207,74,.05),transparent)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, color: "#ffcf4a", textShadow: "0 0 12px rgba(255,207,74,.5)" }}>
            {underlying}
          </div>
          <ConfidenceGauge confidence={conf} color={verdictColor} size={46} />
        </div>
        <div style={{ fontSize: 14, marginTop: 2, letterSpacing: .5, fontVariantNumeric: "tabular-nums" }}>
          {usd(spot)}{" "}
          {changePct != null && (
            <span style={{ fontSize: 10, color: changePct >= 0 ? "#27f59b" : "#ff5470" }}>
              {changePct >= 0 ? "▴" : "▾"} {Math.abs(changePct).toFixed(2)}%
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: stateColor, background: `${stateColor}18`, border: `1px solid ${stateColor}55`, padding: "1px 6px", letterSpacing: 1, textTransform: "uppercase" }}>
            {stateLabel}
          </span>
        </div>
      </div>

      {/* PLAN LINE — current state, next intended action, contract spec */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(64,200,224,.15)" }}>
        <div style={{ fontSize: 7, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 4 }}>PLAN</div>
        <div style={{ fontSize: 9.5, color: "#8fb8c4", letterSpacing: 0.5, lineHeight: 1.6, fontVariantNumeric: "tabular-nums" }}>
          {planLine}
        </div>
        {directive && (
          <div style={{ marginTop: 6 }}>
            <DirectiveCard directive={directive} currency={verdict?.currency} variant="compact" />
          </div>
        )}
        {verdict && (
          <div style={{ fontSize: 8.5, color: "#5b7d8a", fontStyle: "italic", marginTop: 5, lineHeight: 1.5 }}>
            {bandExplanation(verdict.confidence, wheelState === "cash" ? "wheel_cash" : "wheel_stock")}
          </div>
        )}
      </div>

      {/* collapsed summary + EXPLAIN toggle */}
      <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(64,200,224,.15)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "#8fb8c4", fontVariantNumeric: "tabular-nums" }}>
          {openPositions.length} OPEN · {usd(premiumAtRisk, 0)} PREMIUM AT RISK
        </span>
        <button
          onClick={() => setShowExplain((s) => !s)}
          style={{ background: "none", border: "none", color: "#5b7d8a", fontSize: 8, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontFamily: "monospace", padding: 0 }}
        >
          {showExplain ? "▾ hide" : "▸ explain"}
        </button>
      </div>

      {/* EXPLAIN — open positions detail + P&L/collateral grid */}
      {showExplain && (
        <>
          <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid rgba(64,200,224,.15)" }}>
            <div style={{ fontSize: 7, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 6 }}>OPEN POSITIONS</div>
            {openPositions.length === 0 ? (
              <div style={{ fontSize: 10, color: "#365360" }}>NO OPEN POSITIONS</div>
            ) : (
              openPositions.map((pos) => (
                <div key={pos.id} style={{ marginBottom: 8, borderLeft: "2px solid rgba(64,200,224,.2)", paddingLeft: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: "#bfe9f2", letterSpacing: .5 }}>{strategyLabel(pos.strategy)}</span>
                    <span style={{ fontSize: 8, color: "#365360" }}>DTE {pos.dte}</span>
                  </div>
                  <div style={{ fontSize: 9, color: "#5b7d8a", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                    {pos.contractSymbol} · STRIKE {usd(pos.strike, pos.strike >= 100 ? 0 : 2)} · EXP {fmtDate(pos.expiry)}
                  </div>
                  <div style={{ fontSize: 9, color: "#ffcf4a", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                    PREMIUM {usd(pos.premiumTotal, 0)}
                    {pos.delta != null && <span style={{ color: "#5b7d8a", marginLeft: 6 }}>Δ {pos.delta.toFixed(2)}</span>}
                    {pos.theta != null && <span style={{ color: "#ff5470", marginLeft: 6 }}>θ {pos.theta.toFixed(3)}/d</span>}
                  </div>
                  <div style={{ fontSize: 8, color: "#365360", marginTop: 3, lineHeight: 1.4 }}>
                    {plainEnglish(pos, underlying)}
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(64,200,224,.15)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[
                { l: "PREMIUM INCOME", v: usd(totalPremiumIncome, 0) },
                { l: "REALIZED P&L", v: usd(totalRealizedPnl, 0) },
                { l: "COLLATERAL RSRV", v: usd(collateralReserved, 0) },
                { l: "COST BASIS/SH", v: costBasis ? usd(costBasis, 2) : "—" },
              ].map(({ l, v }) => (
                <div key={l} style={cellStyle}>
                  <div style={{ fontSize: 7, letterSpacing: 1, color: "#5b7d8a", textTransform: "uppercase" }}>{l}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#bfe9f2", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* FOOTER */}
      <div style={{ padding: "10px 14px", marginTop: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "4px 0" }}>
          <span style={{ color: "#5b7d8a", letterSpacing: .5 }}>NEXT WHEEL RUN</span>
          <span style={{ color: "#ffcf4a", fontVariantNumeric: "tabular-nums" }}>{fmtDate(nextRun)}</span>
        </div>
      </div>
    </div>
  );
}
