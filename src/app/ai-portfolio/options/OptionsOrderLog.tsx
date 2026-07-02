"use client";

import { useState } from "react";
import { gateLabel, GATE_OUTCOME_COLORS, type GateTrace } from "@/lib/trading/gates";

export type OptionsOrderRow = {
  id: string;
  underlying: string;
  action: string; // open_csp | open_cc | open_long | skip | period_claim
  date: string; // ISO
  detail: {
    symbol?: string;
    strike?: number;
    premium?: number;
    premiumTotal?: number;
    reason?: string;
    verdict?: string;
    confidence?: number;
    gate_trace?: GateTrace;
  } | null;
};

const ACTION_META: Record<string, { label: string; color: string }> = {
  open_csp: { label: "SOLD PUT", color: "#27f59b" },
  open_cc: { label: "SOLD CALL", color: "#46e0f5" },
  open_long: { label: "LONG PLAY", color: "#ffcf4a" },
  skip: { label: "SKIPPED", color: "#5b7d8a" },
  period_claim: { label: "NO ACTION", color: "#365360" },
};

function usd(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).toUpperCase();
}

/** Plain-English one-liner of what the engine actually did. */
function describe(o: OptionsOrderRow): string {
  const d = o.detail ?? {};
  switch (o.action) {
    case "open_csp":
      return `Sold a cash-secured put on ${o.underlying} at $${d.strike ?? "—"} strike — collected ${usd(d.premium)} per unit. If price stays above strike, premium is kept; if not, ${o.underlying} is bought at the pre-agreed price.`;
    case "open_cc":
      return `Sold a covered call on held ${o.underlying} at $${d.strike ?? "—"} strike — collected ${usd(d.premium)} per unit. If price rises above strike, shares sell at a profit; otherwise premium is kept.`;
    case "open_long":
      return `High-conviction directional bet on ${o.underlying} — bought option ${d.symbol ?? ""} for ${usd(d.premiumTotal)} total. Max loss = premium paid.`;
    case "skip":
      return `No trade on ${o.underlying} this run — ${d.reason ?? "see gates"}${d.verdict ? ` (council: ${d.verdict} ${d.confidence ?? "—"}%)` : ""}.`;
    default:
      return `Run claimed for ${o.underlying} — no action recorded.`;
  }
}

type Filter = "all" | "trades" | "skips";

export function OptionsOrderLog({ orders }: { orders: OptionsOrderRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const isTrade = (o: OptionsOrderRow) => o.action.startsWith("open_");
  const counts = {
    all: orders.length,
    trades: orders.filter(isTrade).length,
    skips: orders.filter((o) => !isTrade(o)).length,
  };
  const shown =
    filter === "all" ? orders : filter === "trades" ? orders.filter(isTrade) : orders.filter((o) => !isTrade(o));

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
        <span>[##]</span><span>ACTIONS TAKEN · EVERY ENGINE RUN</span>
        <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg,rgba(64,200,224,.3),transparent)" }} />
      </div>

      {/* filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {(["all", "trades", "skips"] as Filter[]).map((f) => {
          const active = filter === f;
          const c = f === "trades" ? "#27f59b" : f === "skips" ? "#5b7d8a" : "#3fd0e0";
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
          NO ENGINE RUNS YET — first run fires on the Monday cron (or force-run the cron endpoint)
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {shown.map((o) => {
            const meta = ACTION_META[o.action] ?? { label: o.action.toUpperCase(), color: "#5b7d8a" };
            const isExp = expanded === o.id;
            const trace = o.detail?.gate_trace ?? null;
            return (
              <div key={o.id} style={{ borderBottom: "1px solid rgba(64,200,224,.06)" }}>
                <div
                  onClick={() => setExpanded(isExp ? null : o.id)}
                  style={{ display: "grid", gridTemplateColumns: "92px 56px 92px 1fr", gap: 8, padding: "8px", alignItems: "center", cursor: "pointer", fontSize: 10, fontVariantNumeric: "tabular-nums", background: isExp ? "rgba(70,224,245,.04)" : "transparent" }}
                >
                  <span style={{ color: "#8fb8c4" }}>{fmtDateTime(o.date)}</span>
                  <span style={{ color: "#bfe9f2", fontWeight: 700, letterSpacing: 1 }}>{o.underlying}</span>
                  <span style={{ color: meta.color, fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>{meta.label}</span>
                  <span style={{ color: "#8fb8c4", lineHeight: 1.5 }}>{describe(o)}</span>
                </div>
                {isExp && trace && (
                  <div style={{ padding: "4px 8px 12px 8px" }}>
                    <div style={{ fontSize: 7, letterSpacing: 1, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 4 }}>DECISION GATES</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {trace.gates.map((g) => {
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
                  </div>
                )}
                {isExp && !trace && (
                  <div style={{ padding: "0 8px 10px", fontSize: 9, color: "#365360", letterSpacing: 0.5 }}>
                    NO GATE TRACE FOR THIS ROW
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
