"use client";

import { useState } from "react";
import type { Verdict } from "@/lib/council/types";
import { resolveDirective } from "@/lib/council/directive";
import { verdictColor } from "@/lib/council/display";
import { DirectiveCard } from "@/components/council/DirectiveCard";

export type ReasoningEntry = {
  token: string;
  verdict: Verdict | null;
  price: number | null;
  qty?: number;
  costBasis?: number | null;
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

function fmtAgo(iso: string | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "<1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SIGNAL_COLOR: Record<string, string> = { bull: "#27f59b", bear: "#ff5470", neutral: "#ffcf4a" };

export function CouncilReasoning({ entries }: { entries: ReasoningEntry[] }) {
  const [active, setActive] = useState(entries[0]?.token ?? "BTC");
  const entry = entries.find((e) => e.token === active) ?? entries[0];
  const v = entry?.verdict ?? null;
  const c = TOKEN_COLOR[active] ?? "#3fd0e0";

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
        <span>[AI]</span><span>COUNCIL REASONING</span>
        <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg,rgba(64,200,224,.3),transparent)" }} />
      </div>

      {/* token tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {entries.map((e) => {
          const ac = e.token === active;
          const tc = TOKEN_COLOR[e.token] ?? "#3fd0e0";
          const vt = e.verdict?.verdict;
          return (
            <button
              key={e.token}
              onClick={() => setActive(e.token)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: ac ? `${tc}1a` : "rgba(70,224,245,.02)",
                border: `1px solid ${ac ? tc : "rgba(64,200,224,.18)"}`,
                color: ac ? tc : "#5b7d8a",
                fontSize: 11, fontWeight: 700, letterSpacing: 1, padding: "5px 12px",
                cursor: "pointer", fontFamily: "monospace",
              }}
            >
              {e.token}
              {vt && <span style={{ fontSize: 8, color: verdictColor(vt) }}>● {vt}</span>}
            </button>
          );
        })}
      </div>

      {!v ? (
        <div style={{ fontSize: 11, color: "#365360", letterSpacing: 1, padding: "12px 0" }}>
          NO COUNCIL VERDICT YET FOR {active} — runs on the next scheduled tick
        </div>
      ) : (
        <div>
          {/* verdict header */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: verdictColor(v.verdict), letterSpacing: 1, textShadow: `0 0 10px ${verdictColor(v.verdict)}66` }}>
              {v.verdict}
            </span>
            <span style={{ fontSize: 13, color: "#bfe9f2", fontVariantNumeric: "tabular-nums" }}>{v.confidence}% conviction</span>
            <span style={{ fontSize: 10, color: "#5b7d8a" }}>@ {usd(entry?.price)}</span>
            <span style={{ fontSize: 9, color: "#365360", marginLeft: "auto" }}>{fmtAgo(v.generatedAt)}</span>
          </div>

          {/* actionable directive (long-only spot → no short) */}
          <div style={{ marginBottom: 14 }}>
            <DirectiveCard
              directive={resolveDirective({
                verdict: v.verdict,
                confidence: v.confidence,
                tradeLevels: v.tradeLevels,
                currentPrice: entry?.price ?? null,
                position: (entry?.qty ?? 0) > 0
                  ? { held: true, qty: entry!.qty!, costBasis: entry?.costBasis ?? null }
                  : { held: false },
                venue: "spot",
              })}
              currency={v.currency}
            />
          </div>

          {/* summary */}
          {v.summary && (
            <div style={{ fontSize: 12, lineHeight: 1.6, color: "#bfe9f2", marginBottom: 14, paddingLeft: 10, borderLeft: `2px solid ${c}55` }}>
              {v.summary}
            </div>
          )}

          {/* trade levels */}
          {v.tradeLevels && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 8, marginBottom: 14 }}>
              {[
                { l: "ENTRY ZONE", v: `${usd(v.tradeLevels.entry.low)} – ${usd(v.tradeLevels.entry.high)}`, col: "#27f59b" },
                { l: "TARGET", v: `${usd(v.tradeLevels.target.low)} – ${usd(v.tradeLevels.target.high)}`, col: "#46e0f5" },
                { l: "STOP LOSS", v: usd(v.tradeLevels.stopLoss), col: "#ff5470" },
              ].map(({ l, v: val, col }) => (
                <div key={l} style={{ border: `1px solid ${col}33`, background: `${col}08`, padding: "7px 9px" }}>
                  <div style={{ fontSize: 7, letterSpacing: 1, color: "#5b7d8a", textTransform: "uppercase" }}>{l}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: col, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{val}</div>
                </div>
              ))}
            </div>
          )}

          {/* layman explanation */}
          {v.laymanExplanation && (
            <div style={{ border: "1px solid rgba(64,200,224,.15)", background: "rgba(70,224,245,.02)", padding: "10px 12px", marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#ffcf4a", marginBottom: 6 }}>{v.laymanExplanation.action}</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "#8fb8c4", lineHeight: 1.6 }}>
                {v.laymanExplanation.why.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              {v.laymanExplanation.whenToReconsider && (
                <div style={{ fontSize: 10, color: "#5b7d8a", marginTop: 8 }}>
                  <span style={{ color: "#3fd0e0", textTransform: "uppercase", letterSpacing: 1 }}>RECONSIDER: </span>
                  {v.laymanExplanation.whenToReconsider}
                </div>
              )}
            </div>
          )}

          {/* agent panel */}
          {v.agents.length > 0 && (
            <>
              <div style={{ fontSize: 8, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 8 }}>
                COUNCIL VOTES · {v.agents.length} AGENTS
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 8 }}>
                {v.agents.map((a) => (
                  <div key={a.role} style={{ border: "1px solid rgba(64,200,224,.12)", background: "rgba(70,224,245,.02)", padding: "9px 11px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#bfe9f2", letterSpacing: .5, textTransform: "uppercase" }}>{a.role}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, color: SIGNAL_COLOR[a.signal] ?? "#5b7d8a", textTransform: "uppercase" }}>
                        {a.signal} · {a.confidence}%
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: "#8fb8c4", lineHeight: 1.5, marginBottom: a.keyPoints.length ? 6 : 0 }}>{a.thesis}</div>
                    {a.keyPoints.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 14, fontSize: 9, color: "#5b7d8a", lineHeight: 1.5 }}>
                        {a.keyPoints.slice(0, 3).map((k, i) => <li key={i}>{k}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
