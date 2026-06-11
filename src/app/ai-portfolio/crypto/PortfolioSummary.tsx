"use client";

import { useState } from "react";

export type AllocSlice = { token: string; value: number; pct: number };

export type BreakdownRow = {
  token: string;
  qty: number;
  price: number | null;
  value: number;
  cost: number;
  pnl: number | null;
  pnlPct: number | null;
  pct: number;
};

const TOKEN_COLOR: Record<string, string> = {
  BTC: "#ffcf4a",
  ETH: "#46e0f5",
  SOL: "#27f59b",
  HYPE: "#b56bff",
};

function usd(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

export function PortfolioSummary({
  totalValue,
  totalCost,
  totalPnl,
  totalPnlPct,
  alloc,
  breakdown,
}: {
  totalValue: number;
  totalCost: number;
  totalPnl: number | null;
  totalPnlPct: number | null;
  alloc: AllocSlice[];
  breakdown?: BreakdownRow[];
}) {
  const bd = breakdown ?? [];
  const [view, setView] = useState<"alloc" | "breakdown">("alloc");
  const showBreakdownToggle = bd.length > 0;
  const hasPositions = totalValue > 0;
  const pnlColor = totalPnl == null ? "#365360" : totalPnl >= 0 ? "#27f59b" : "#ff5470";

  return (
    <div
      style={{
        position: "relative",
        background: "rgba(8,18,28,.6)",
        border: "1px solid rgba(64,200,224,.22)",
        clipPath:
          "polygon(0 14px,14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px))",
        backdropFilter: "blur(2px)",
        marginBottom: 16,
        padding: "16px 20px",
      }}
    >
      {[
        { top: 5, left: 5, borderTop: "2px solid", borderLeft: "2px solid" },
        { top: 5, right: 5, borderTop: "2px solid", borderRight: "2px solid" },
        { bottom: 5, left: 5, borderBottom: "2px solid", borderLeft: "2px solid" },
        { bottom: 5, right: 5, borderBottom: "2px solid", borderRight: "2px solid" },
      ].map((s, i) => (
        <div key={i} style={{ position: "absolute", width: 16, height: 16, pointerEvents: "none", borderColor: "rgba(70,224,245,.5)", ...s }} />
      ))}

      <div style={{ fontSize: 8, letterSpacing: 3, color: "#3fd0e0", textTransform: "uppercase", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
        <span>[00]</span><span>TOTAL POSITION</span>
        <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg,rgba(64,200,224,.3),transparent)" }} />
        {showBreakdownToggle && (["alloc", "breakdown"] as const).map((v) => {
          const active = view === v;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                background: active ? "rgba(70,224,245,.16)" : "rgba(70,224,245,.02)",
                border: `1px solid ${active ? "#3fd0e0" : "rgba(64,200,224,.18)"}`,
                color: active ? "#3fd0e0" : "#5b7d8a",
                fontSize: 8, letterSpacing: 1, padding: "3px 8px",
                textTransform: "uppercase", cursor: "pointer", fontFamily: "monospace",
              }}
            >
              {v === "alloc" ? "◐ ALLOCATION" : "▤ BREAKDOWN"}
            </button>
          );
        })}
      </div>

      {/* totals */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 16 }}>
        {[
          { l: "TOTAL VALUE", v: usd(totalValue), c: "#bfe9f2" },
          { l: "TOTAL COST BASIS", v: usd(totalCost), c: "#bfe9f2" },
          {
            l: "TOTAL UNREALIZED P&L",
            v:
              totalPnl == null
                ? "—"
                : `${totalPnl >= 0 ? "+" : ""}${usd(totalPnl)}${totalPnlPct != null ? `  (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(1)}%)` : ""}`,
            c: pnlColor,
          },
        ].map(({ l, v, c }) => (
          <div key={l}>
            <div style={{ fontSize: 8, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 6 }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c, fontVariantNumeric: "tabular-nums", textShadow: `0 0 8px ${c}40` }}>{v}</div>
          </div>
        ))}
      </div>

      {view === "breakdown" && showBreakdownToggle ? (
        hasPositions ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 1fr 1fr 64px", gap: 8, padding: "0 8px 6px", fontSize: 7, letterSpacing: 1, color: "#5b7d8a", textTransform: "uppercase", borderBottom: "1px solid rgba(64,200,224,.15)" }}>
              <span>TOKEN</span>
              <span style={{ textAlign: "right" }}>HOLDING</span>
              <span style={{ textAlign: "right" }}>MARK VALUE</span>
              <span style={{ textAlign: "right" }}>COST BASIS</span>
              <span style={{ textAlign: "right" }}>UNREAL P&L</span>
              <span style={{ textAlign: "right" }}>ALLOC</span>
            </div>
            {bd.filter((b) => b.value > 0).map((b) => {
              const c = TOKEN_COLOR[b.token] ?? "#3fd0e0";
              const pc = b.pnl == null ? "#365360" : b.pnl >= 0 ? "#27f59b" : "#ff5470";
              return (
                <div key={b.token} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 1fr 1fr 64px", gap: 8, padding: "8px", alignItems: "center", fontSize: 11, fontVariantNumeric: "tabular-nums", borderBottom: "1px solid rgba(64,200,224,.06)" }}>
                  <span style={{ color: c, fontWeight: 700, letterSpacing: 1 }}>{b.token}</span>
                  <span style={{ textAlign: "right", color: "#8fb8c4" }}>{b.qty > 0 ? b.qty.toFixed(4) : "—"}</span>
                  <span style={{ textAlign: "right", color: "#bfe9f2" }}>{usd(b.value)}</span>
                  <span style={{ textAlign: "right", color: "#8fb8c4" }}>{usd(b.cost)}</span>
                  <span style={{ textAlign: "right", color: pc }}>
                    {b.pnl == null ? "—" : `${b.pnl >= 0 ? "+" : ""}${usd(b.pnl)}`}
                    {b.pnlPct != null && <span style={{ fontSize: 8, marginLeft: 4 }}>{b.pnlPct >= 0 ? "+" : ""}{b.pnlPct.toFixed(1)}%</span>}
                  </span>
                  <span style={{ textAlign: "right", color: "#5b7d8a" }}>{(b.pct * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "#365360", letterSpacing: 1, padding: "6px 0" }}>
            NO OPEN POSITIONS — awaiting first fill
          </div>
        )
      ) : (
      <>
      {/* allocation bar */}
      <div style={{ fontSize: 8, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 8 }}>ALLOCATION</div>
      {hasPositions ? (
        <>
          <div style={{ display: "flex", height: 12, border: "1px solid rgba(64,200,224,.2)", background: "rgba(0,0,0,.4)", overflow: "hidden" }}>
            {alloc
              .filter((a) => a.pct > 0)
              .map((a) => (
                <div
                  key={a.token}
                  title={`${a.token} ${(a.pct * 100).toFixed(1)}%`}
                  style={{
                    width: `${a.pct * 100}%`,
                    background: TOKEN_COLOR[a.token] ?? "#3fd0e0",
                    boxShadow: `inset 0 0 8px ${TOKEN_COLOR[a.token] ?? "#3fd0e0"}aa`,
                  }}
                />
              ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10 }}>
            {alloc.map((a) => (
              <div key={a.token} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontVariantNumeric: "tabular-nums" }}>
                <span style={{ width: 8, height: 8, background: TOKEN_COLOR[a.token] ?? "#3fd0e0", display: "inline-block", boxShadow: `0 0 6px ${TOKEN_COLOR[a.token] ?? "#3fd0e0"}` }} />
                <span style={{ color: "#bfe9f2", letterSpacing: .5 }}>{a.token}</span>
                <span style={{ color: "#5b7d8a" }}>{(a.pct * 100).toFixed(1)}%</span>
                <span style={{ color: "#365360" }}>· {usd(a.value, 0)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11, color: "#365360", letterSpacing: 1, padding: "6px 0" }}>
          NO OPEN POSITIONS — awaiting first fill
        </div>
      )}
      </>
      )}
    </div>
  );
}
