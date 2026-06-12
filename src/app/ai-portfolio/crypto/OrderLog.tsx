"use client";

import { useState } from "react";
import { gateLabel, GATE_OUTCOME_COLORS, type GateTrace } from "@/lib/trading/gates";

export type OrderRow = {
  id: string;
  token: string;
  date: string; // ISO
  status: string; // filled | skipped | failed | pending
  usdAmount: number;
  qty: number | null;
  price: number | null;
  boosted: boolean;
  verdict: string | null;
  confidence: number | null;
  dipDepthPct: number | null;
  error: string | null;
  exchangeOrderId: string | null;
  gateTrace: GateTrace | null; // null on rows written before trace deploy
};

export type TokenPlan = {
  nextRunAt: string | null; // ISO
  plannedUsd: number;
  boostUsd: number;
  consecutiveSkips: number;
  maxSkips: number;
};

const TOKEN_COLOR: Record<string, string> = {
  BTC: "#ffcf4a",
  ETH: "#46e0f5",
  SOL: "#27f59b",
  HYPE: "#b56bff",
};

const STATUS_COLOR: Record<string, string> = {
  filled: "#27f59b",
  skipped: "#5b7d8a",
  failed: "#ff5470",
  pending: "#ffcf4a",
};

function usd(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).toUpperCase();
}

type Filter = "all" | "filled" | "skipped" | "failed";

export function OrderLog({ orders, planByToken = {} }: { orders: OrderRow[]; planByToken?: Record<string, TokenPlan> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = {
    all: orders.length,
    filled: orders.filter((o) => o.status === "filled").length,
    skipped: orders.filter((o) => o.status === "skipped").length,
    failed: orders.filter((o) => o.status === "failed").length,
  };

  const shown = filter === "all" ? orders : orders.filter((o) => o.status === filter);

  return (
    <div
      style={{
        position: "relative",
        background: "rgba(8,18,28,.6)",
        border: "1px solid rgba(64,200,224,.22)",
        clipPath:
          "polygon(0 14px,14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px))",
        backdropFilter: "blur(2px)",
        marginTop: 16,
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
        <span>[##]</span><span>ORDER LOG · EVERY EXECUTION</span>
        <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg,rgba(64,200,224,.3),transparent)" }} />
      </div>

      {/* filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {(["all", "filled", "skipped", "failed"] as Filter[]).map((f) => {
          const active = filter === f;
          const c = f === "all" ? "#3fd0e0" : STATUS_COLOR[f];
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: active ? `${c}18` : "rgba(70,224,245,.02)",
                border: `1px solid ${active ? c : "rgba(64,200,224,.18)"}`,
                color: active ? c : "#5b7d8a",
                fontSize: 9, letterSpacing: 1, padding: "4px 10px",
                textTransform: "uppercase", cursor: "pointer", fontFamily: "monospace",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {f} · {counts[f]}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div style={{ fontSize: 11, color: "#365360", letterSpacing: 1, padding: "12px 0" }}>
          NO ORDERS — awaiting first execution
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* header row */}
          <div style={{ display: "grid", gridTemplateColumns: "92px 56px 1fr 84px 96px 70px", gap: 8, padding: "0 8px 6px", fontSize: 7, letterSpacing: 1, color: "#5b7d8a", textTransform: "uppercase", borderBottom: "1px solid rgba(64,200,224,.15)" }}>
            <span>WHEN</span><span>TOKEN</span><span>VERDICT</span><span style={{ textAlign: "right" }}>AMOUNT</span><span style={{ textAlign: "right" }}>FILL PRICE</span><span style={{ textAlign: "right" }}>STATUS</span>
          </div>
          {shown.map((o) => {
            const tc = TOKEN_COLOR[o.token] ?? "#3fd0e0";
            const sc = STATUS_COLOR[o.status] ?? "#5b7d8a";
            const isExp = expanded === o.id;
            return (
              <div key={o.id} style={{ borderBottom: "1px solid rgba(64,200,224,.06)" }}>
                <div
                  onClick={() => setExpanded(isExp ? null : o.id)}
                  style={{ display: "grid", gridTemplateColumns: "92px 56px 1fr 84px 96px 70px", gap: 8, padding: "8px", alignItems: "center", cursor: "pointer", fontSize: 10, fontVariantNumeric: "tabular-nums", background: isExp ? "rgba(70,224,245,.04)" : "transparent" }}
                >
                  <span style={{ color: "#8fb8c4" }}>{fmtDateTime(o.date)}</span>
                  <span style={{ color: tc, fontWeight: 700, letterSpacing: 1 }}>{o.token}</span>
                  <span style={{ color: "#8fb8c4" }}>
                    {o.verdict ? (
                      <>
                        <span style={{ color: o.verdict === "BUY" ? "#27f59b" : o.verdict === "SELL" ? "#ff5470" : "#ffcf4a", fontWeight: 700 }}>{o.verdict}</span>
                        {o.confidence != null && <span style={{ color: "#5b7d8a" }}> {o.confidence}%</span>}
                        {o.boosted && <span style={{ color: "#ffcf4a", marginLeft: 4 }}>▲BOOST</span>}
                      </>
                    ) : (
                      <span style={{ color: "#365360" }}>—</span>
                    )}
                  </span>
                  <span style={{ textAlign: "right", color: "#bfe9f2" }}>{usd(o.usdAmount)}</span>
                  <span style={{ textAlign: "right", color: o.price ? "#bfe9f2" : "#365360" }}>{o.price ? usd(o.price) : "—"}</span>
                  <span style={{ textAlign: "right", color: sc, textTransform: "uppercase", fontSize: 9, fontWeight: 700 }}>{o.status}</span>
                </div>
                {isExp && (
                  <div style={{ padding: "4px 8px 12px 8px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px,1fr))", gap: 8, fontSize: 9 }}>
                    {/* gate-by-gate decision trace */}
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ fontSize: 7, letterSpacing: 1, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 4 }}>DECISION GATES</div>
                      {o.gateTrace ? (
                        <>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {o.gateTrace.gates.map((g) => {
                              const gc = GATE_OUTCOME_COLORS[g.outcome] ?? "#365360";
                              const dimmed = g.outcome === "not_reached";
                              return (
                                <span
                                  key={g.id}
                                  title={g.detail ?? g.outcome}
                                  style={{
                                    fontSize: 7, letterSpacing: 1, textTransform: "uppercase",
                                    color: gc, background: dimmed ? "transparent" : `${gc}14`,
                                    border: `1px solid ${dimmed ? "rgba(54,83,96,.4)" : `${gc}55`}`,
                                    padding: "3px 6px", whiteSpace: "nowrap",
                                  }}
                                >
                                  {g.outcome === "pass" ? "✓" : g.outcome === "not_reached" ? "·" : "✕"} {gateLabel(g.id)}
                                </span>
                              );
                            })}
                          </div>
                          {(() => {
                            const stopped = o.gateTrace.gates.find((g) => (g.outcome === "halt" || g.outcome === "fail" || g.outcome === "skip") && g.detail);
                            return stopped ? (
                              <div style={{ fontSize: 9, color: "#ffb3c0", marginTop: 4, lineHeight: 1.5 }}>
                                ✕ {gateLabel(stopped.id)}: {stopped.detail}
                              </div>
                            ) : null;
                          })()}
                        </>
                      ) : (
                        <div style={{ fontSize: 9, color: "#365360", letterSpacing: 0.5 }}>
                          GATE TRACE UNAVAILABLE — recorded for orders after trace deploy
                        </div>
                      )}
                    </div>

                    {/* what the strategy plans next for this token */}
                    {planByToken[o.token] && (
                      <div style={{ gridColumn: "1 / -1", border: "1px solid rgba(64,200,224,.1)", background: "rgba(70,224,245,.02)", padding: "6px 8px" }}>
                        <div style={{ fontSize: 7, letterSpacing: 1, color: "#5b7d8a", textTransform: "uppercase" }}>PLAN FOR {o.token}</div>
                        <div style={{ fontSize: 9, color: "#8fb8c4", marginTop: 3, lineHeight: 1.6, fontVariantNumeric: "tabular-nums" }}>
                          {(() => {
                            const p = planByToken[o.token];
                            const next = p.nextRunAt
                              ? new Date(p.nextRunAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()
                              : "DUE NOW";
                            return `NEXT RUN ${next} · PLANNED ${usd(p.plannedUsd, 0)} (BOOST ${usd(p.boostUsd, 0)} if dip) · SKIPS ${p.consecutiveSkips}/${p.maxSkips}`;
                          })()}
                        </div>
                      </div>
                    )}

                    {[
                      { l: "QTY FILLED", v: o.qty != null ? o.qty.toFixed(8) : "—" },
                      { l: "DIP DEPTH", v: o.dipDepthPct != null ? `${o.dipDepthPct.toFixed(1)}%` : "—" },
                      { l: "EXCHANGE OID", v: o.exchangeOrderId ?? "—" },
                    ].map(({ l, v }) => (
                      <div key={l} style={{ border: "1px solid rgba(64,200,224,.1)", background: "rgba(70,224,245,.02)", padding: "6px 8px" }}>
                        <div style={{ fontSize: 7, letterSpacing: 1, color: "#5b7d8a", textTransform: "uppercase" }}>{l}</div>
                        <div style={{ fontSize: 10, color: "#bfe9f2", marginTop: 3, fontVariantNumeric: "tabular-nums", wordBreak: "break-all" }}>{v}</div>
                      </div>
                    ))}
                    {o.error && (
                      <div style={{ gridColumn: "1 / -1", border: "1px solid rgba(255,84,112,.3)", background: "rgba(255,84,112,.05)", padding: "6px 8px" }}>
                        <div style={{ fontSize: 7, letterSpacing: 1, color: "#ff5470", textTransform: "uppercase" }}>REASON / ERROR</div>
                        <div style={{ fontSize: 10, color: "#ffb3c0", marginTop: 3, lineHeight: 1.5 }}>{o.error}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
