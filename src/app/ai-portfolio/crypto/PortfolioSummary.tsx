"use client";

import { useState, useEffect, useRef } from "react";

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
  labels,
}: {
  totalValue: number;
  totalCost: number;
  totalPnl: number | null;
  totalPnlPct: number | null;
  alloc: AllocSlice[];
  breakdown?: BreakdownRow[];
  labels?: { value?: string; cost?: string; pnl?: string };
}) {
  const bd = breakdown ?? [];
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  const hasPositions = totalValue > 0;
  const pnlPos = totalPnl == null ? false : totalPnl >= 0;
  const pnlColor = totalPnl == null ? "#5b7d8a" : pnlPos ? "#27f59b" : "#ff5470";

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    function onOutside(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [open]);

  return (
    <>
      {/* hero band — full-width, amber, visually distinct from the cyan panels below */}
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            position: "relative",
            display: "block",
            width: "100%",
            background: "linear-gradient(135deg, rgba(40,28,6,.85), rgba(14,10,2,.92) 55%, rgba(8,18,28,.85))",
            border: "1px solid rgba(255,207,74,.45)",
            boxShadow: "0 0 18px rgba(255,207,74,.08), inset 0 0 30px rgba(255,207,74,.04)",
            clipPath: "polygon(0 12px,12px 0,calc(100% - 12px) 0,100% 12px,100% calc(100% - 12px),calc(100% - 12px) 100%,12px 100%,0 calc(100% - 12px))",
            padding: "14px 20px",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          {/* corner accents */}
          {[
            { top: 3, left: 3, borderTop: "2px solid", borderLeft: "2px solid" },
            { top: 3, right: 3, borderTop: "2px solid", borderRight: "2px solid" },
            { bottom: 3, left: 3, borderBottom: "2px solid", borderLeft: "2px solid" },
            { bottom: 3, right: 3, borderBottom: "2px solid", borderRight: "2px solid" },
          ].map((s, i) => (
            <div key={i} style={{ position: "absolute", width: 12, height: 12, pointerEvents: "none", borderColor: "rgba(255,207,74,.6)", ...s }} />
          ))}

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div style={{ fontSize: 8, letterSpacing: 3, color: "#ffcf4a", textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span>◈</span><span>TOTAL POSITION</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#ffe9b0", fontVariantNumeric: "tabular-nums", lineHeight: 1, textShadow: "0 0 14px rgba(255,207,74,.35)" }}>
                {usd(totalValue)}
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 8, letterSpacing: 2, color: "#8a7340", textTransform: "uppercase", marginBottom: 6 }}>UNREALIZED P&L</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: pnlColor, fontVariantNumeric: "tabular-nums" }}>
                {totalPnl == null ? "—" : `${pnlPos ? "+" : ""}${usd(totalPnl)}`}
                {totalPnlPct != null && (
                  <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.8 }}>
                    ({totalPnlPct >= 0 ? "+" : ""}{totalPnlPct.toFixed(1)}%)
                  </span>
                )}
              </div>
              <div style={{ fontSize: 9, color: "#ffcf4a", letterSpacing: 1, marginTop: 5 }}>▸ DETAIL</div>
            </div>
          </div>

          {/* alloc bar */}
          {hasPositions && (
            <div style={{ display: "flex", height: 4, marginTop: 12, overflow: "hidden", gap: 1 }}>
              {alloc.filter((a) => a.pct > 0).map((a) => (
                <div key={a.token} style={{ width: `${a.pct * 100}%`, height: "100%", background: TOKEN_COLOR[a.token] ?? "#3fd0e0" }} />
              ))}
            </div>
          )}
        </button>
      </div>

      {/* popup overlay */}
      {open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 999,
            background: "rgba(0,0,0,.55)",
            display: "flex", alignItems: "flex-start", justifyContent: "flex-start",
            padding: "80px 0 0 24px",
          }}
        >
          <div
            ref={popRef}
            style={{
              position: "relative",
              background: "rgba(6,14,24,.97)",
              border: "1px solid rgba(64,200,224,.3)",
              clipPath: "polygon(0 16px,16px 0,calc(100% - 16px) 0,100% 16px,100% calc(100% - 16px),calc(100% - 16px) 100%,16px 100%,0 calc(100% - 16px))",
              width: 380,
              maxHeight: "80vh",
              overflowY: "auto",
              padding: "18px 20px",
            }}
          >
            {/* corner accents */}
            {[
              { top: 5, left: 5, borderTop: "2px solid", borderLeft: "2px solid" },
              { top: 5, right: 5, borderTop: "2px solid", borderRight: "2px solid" },
              { bottom: 5, left: 5, borderBottom: "2px solid", borderLeft: "2px solid" },
              { bottom: 5, right: 5, borderBottom: "2px solid", borderRight: "2px solid" },
            ].map((s, i) => (
              <div key={i} style={{ position: "absolute", width: 14, height: 14, pointerEvents: "none", borderColor: "rgba(70,224,245,.5)", ...s }} />
            ))}

            {/* popup header */}
            <div style={{ fontSize: 8, letterSpacing: 3, color: "#3fd0e0", textTransform: "uppercase", marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
              <span>[00]</span><span>TOTAL POSITION</span>
              <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg,rgba(64,200,224,.3),transparent)" }} />
              <button
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", color: "#5b7d8a", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            {/* KPI stack */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid rgba(64,200,224,.12)" }}>
              {[
                { label: labels?.value ?? "TOTAL VALUE", value: usd(totalValue), color: "#bfe9f2" },
                { label: labels?.cost ?? "COST BASIS", value: usd(totalCost), color: "#8fb8c4" },
                {
                  label: labels?.pnl ?? "UNREALIZED P&L",
                  value: totalPnl == null ? "—" : `${pnlPos ? "+" : ""}${usd(totalPnl)}`,
                  sub: totalPnlPct != null ? `${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(1)}%` : null,
                  color: pnlColor,
                },
              ].map(({ label, value, sub, color }) => (
                <div key={label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 9, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", flexShrink: 0 }}>{label}</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontVariantNumeric: "tabular-nums" }}>
                    {sub && <span style={{ fontSize: 10, color, opacity: 0.7 }}>{sub}</span>}
                    <span style={{ fontSize: 16, fontWeight: 700, color, textShadow: `0 0 8px ${color}40` }}>{value}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* alloc bar */}
            {hasPositions && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 7, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 6 }}>ALLOCATION</div>
                <div style={{ display: "flex", height: 7, border: "1px solid rgba(64,200,224,.2)", background: "rgba(0,0,0,.4)", overflow: "hidden", marginBottom: 8 }}>
                  {alloc.filter((a) => a.pct > 0).map((a) => (
                    <div key={a.token} style={{ width: `${a.pct * 100}%`, height: "100%", background: TOKEN_COLOR[a.token] ?? "#3fd0e0" }} />
                  ))}
                </div>
              </div>
            )}

            {/* per-token rows */}
            {hasPositions ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {bd.filter((b) => b.value > 0).map((b) => {
                  const col = TOKEN_COLOR[b.token] ?? "#3fd0e0";
                  const pc = b.pnl == null ? "#5b7d8a" : b.pnl >= 0 ? "#27f59b" : "#ff5470";
                  return (
                    <div key={b.token} style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(64,200,224,.07)" }}>
                      <span style={{ color: col, fontWeight: 700, fontSize: 11, letterSpacing: 1 }}>{b.token}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ height: 3, background: "rgba(0,0,0,.4)", overflow: "hidden" }}>
                          <div style={{ width: `${b.pct * 100}%`, height: "100%", background: col }} />
                        </div>
                        <div style={{ display: "flex", gap: 8, fontSize: 9, fontVariantNumeric: "tabular-nums", color: "#5b7d8a" }}>
                          <span>{(b.pct * 100).toFixed(1)}%</span>
                          <span>{b.qty > 0 ? b.qty.toFixed(4) : "—"}</span>
                          <span>@ {usd(b.price, 0)}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#bfe9f2" }}>{usd(b.value)}</div>
                        <div style={{ fontSize: 9, color: pc, marginTop: 1 }}>
                          {b.pnl == null ? "—" : `${b.pnl >= 0 ? "+" : ""}${usd(b.pnl)}`}
                          {b.pnlPct != null && <span style={{ marginLeft: 3 }}>{b.pnlPct >= 0 ? "+" : ""}{b.pnlPct.toFixed(1)}%</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#365360", letterSpacing: 1 }}>NO OPEN POSITIONS — awaiting first fill</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
