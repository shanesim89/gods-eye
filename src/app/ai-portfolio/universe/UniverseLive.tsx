"use client";
import { useState } from "react";
import { useLivePoll } from "../_components/useLivePoll";
import type { UniverseDashboardData, WireOpenPosition, WireTradeEvent } from "@/lib/trading/universe-dashboard";

function usd(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).toUpperCase();
}

function PositionCard({ p, stopPct, targetPct }: { p: WireOpenPosition; stopPct: number; targetPct: number }) {
  const pnlColor = (p.unrealizedPnl ?? 0) >= 0 ? "text-green" : "text-red";
  return (
    <div className="border border-border bg-grid p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-bold text-amber">{p.symbol}</span>
        <span className={`text-[12px] tabular-nums ${pnlColor}`}>
          {usd(p.unrealizedPnl, 0)} ({pct(p.unrealizedPnlPct)})
        </span>
      </div>
      <div className="text-[11px] text-dim tabular-nums leading-[1.8]">
        <div>ENTRY {usd(p.entryPrice)} × {p.qty} · NOW {usd(p.price)}</div>
        <div>STOP (-{(stopPct * 100).toFixed(0)}%) {usd(p.stopPrice)} · TARGET (+{(targetPct * 100).toFixed(0)}%) {usd(p.targetPrice)}</div>
        <div>HELD {p.daysHeld}D · OCO {p.hasOco ? <span className="text-green">ATTACHED</span> : <span className="text-red">MISSING</span>}</div>
      </div>
    </div>
  );
}

function OrderLog({ orders }: { orders: WireTradeEvent[] }) {
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");
  const shown = filter === "all" ? orders : orders.filter((o) => o.side === filter);
  const counts = { all: orders.length, buy: orders.filter((o) => o.side === "buy").length, sell: orders.filter((o) => o.side === "sell").length };

  return (
    <div className="border border-border bg-grid p-3 mt-4">
      <div className="text-muted text-[12px] uppercase tracking-[1px] mb-2">TRADE LOG</div>
      <div className="flex gap-2 mb-3">
        {(["all", "buy", "sell"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="text-[9px] uppercase tracking-[1px] px-2 py-1 border"
            style={{
              background: filter === f ? "rgba(70,224,245,.1)" : "transparent",
              borderColor: filter === f ? "rgba(64,200,224,.6)" : "rgba(64,200,224,.18)",
              color: filter === f ? "#3fd0e0" : "#5b7d8a",
            }}
          >
            {f} · {counts[f]}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="text-[11px] text-dim py-3">NO TRADES YET</div>
      ) : (
        <div className="flex flex-col">
          {shown.map((o) => (
            <div key={o.id} className="grid grid-cols-[100px_60px_70px_1fr] gap-2 py-1.5 border-b border-border/40 text-[11px] tabular-nums">
              <span className="text-dim">{fmtDateTime(o.eventAt)}</span>
              <span className="font-bold text-amber">{o.symbol}</span>
              <span className={o.side === "buy" ? "text-green" : "text-red"}>{(o.side ?? "").toUpperCase()}</span>
              <span className="text-dim">{o.qty} @ {usd(o.price)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function UniverseLive({ initial }: { initial: UniverseDashboardData }) {
  const { state, secsAgo, updatedAt } = useLivePoll<UniverseDashboardData>(
    "/api/ai-portfolio/universe/state",
    initial,
  );
  const stale = secsAgo > 90;
  const capacityPct = state.maxPositions > 0 ? Math.min(100, (state.openCount / state.maxPositions) * 100) : 0;

  return (
    <>
      <div className="flex items-center gap-2 mb-2 text-[12px]">
        <span className={`inline-flex items-center gap-1 ${stale ? "text-amber" : "text-green"}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${stale ? "bg-amber" : "bg-green animate-pulse"}`} />
          {stale ? "STALE" : "LIVE"}
        </span>
        <span className="text-dim">{updatedAt ? `updated ${secsAgo}s ago` : "polling every 20s"}</span>
      </div>

      <div style={{ background: "rgba(255,207,74,.06)", border: "1px solid rgba(255,207,74,.35)", padding: "10px 14px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ fontSize: 14, color: "#ffcf4a", flexShrink: 0 }}>⚠</span>
        <div style={{ fontSize: 12, color: "#ffcf4a", lineHeight: 1.6 }}>
          <strong>PAPER TRADING — SIMULATED ONLY.</strong> Real broker fills on a paper Alpaca account. No real money is moved.
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mb-4 border border-border bg-grid p-3 text-[12px] tabular-nums">
        <div>
          <span className="text-muted uppercase tracking-[1px] mr-2">UNREALIZED P&amp;L</span>
          <span className={state.totalUnrealizedPnl >= 0 ? "text-green" : "text-red"}>{usd(state.totalUnrealizedPnl, 0)}</span>
        </div>
        <div>
          <span className="text-muted uppercase tracking-[1px] mr-2">REALIZED P&amp;L</span>
          <span className={state.totalRealizedPnl >= 0 ? "text-green" : "text-red"}>{usd(state.totalRealizedPnl, 0)}</span>
        </div>
        <div>
          <span className="text-muted uppercase tracking-[1px] mr-2">OPEN</span>
          <span className="text-amber">{state.openCount} / {state.maxPositions}</span>
        </div>
      </div>

      {/* HOW THIS WORKS explainer */}
      <details style={{ marginBottom: 16, border: "1px solid rgba(64,200,224,.15)", background: "rgba(70,224,245,.02)" }}>
        <summary style={{ padding: "8px 14px", fontSize: 9, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", cursor: "pointer", userSelect: "none" }}>
          HOW THIS BOT DECIDES — IN PLAIN ENGLISH ▸
        </summary>
        <div style={{ padding: "10px 14px 14px", fontSize: 12, color: "#bfe9f2", lineHeight: 1.8, borderTop: "1px solid rgba(64,200,224,.1)" }}>
          <p style={{ marginBottom: 8 }}>
            Every 15 minutes during market hours, the bot scans a fixed 30-symbol tech mega-cap universe
            for stocks in a confirmed uptrend (50-day average above 200-day average) that have <em>pulled back</em>
            to their 20-day average — a dip inside a rally, not a falling knife.
          </p>
          <p style={{ marginBottom: 8 }}>
            Survivors are then run through <strong style={{ color: "#ffcf4a" }}>Kronos</strong>, a real price-forecasting
            model — not a stub. If Kronos doesn&apos;t predict the price going up from here, the trade is skipped, no
            matter how good the pullback looks. This gate is a hard requirement: if the model fails to load, the bot
            refuses to trade rather than trading blind.
          </p>
          <p style={{ marginBottom: 8 }}>
            The strongest surviving candidate gets a whole-share market buy sized to 20% of account equity, capped at
            {" "}{state.maxPositions} open positions at once. The instant the fill confirms, a broker-side bracket order
            (stop-loss / take-profit) is attached off the real fill price — never the pre-trade estimate.
          </p>
          <p>
            <strong style={{ color: "#ff5470" }}>Safety gates:</strong> a daily-loss kill switch, a market-regime check
            (SPY below its 200-day average halts new buys), a {state.cooldownHours}h cooldown per symbol after a
            stop-out, and a time stop that force-closes anything held too long.
          </p>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-4 mb-4 border border-border bg-grid p-3">
        <div className="flex items-center gap-2">
          <span className="text-muted text-[12px] uppercase tracking-[1px]">KILL SWITCH</span>
          <span className="text-[12px] text-dim" title="File-based on the VPS — no remote toggle from this dashboard">
            FILE-BASED · READ-ONLY
          </span>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex justify-between text-[12px] uppercase tracking-[1px] mb-1">
            <span className="text-muted">CAPACITY</span>
            <span className="text-amber tabular-nums">{state.openCount} / {state.maxPositions}</span>
          </div>
          <div className="h-1.5 bg-black border border-border">
            <div className={`h-full ${capacityPct >= 100 ? "bg-red" : "bg-amber"}`} style={{ width: `${capacityPct}%` }} />
          </div>
        </div>
        <div className="text-[12px] text-dim uppercase tracking-[1px]">
          POSITION SIZE {(state.positionPct * 100).toFixed(0)}% · STOP -{(state.stopPct * 100).toFixed(0)}% · TARGET +{(state.targetPct * 100).toFixed(0)}%
        </div>
      </div>

      {state.openPositions.length === 0 ? (
        <div className="border border-border bg-grid p-4 text-[12px] text-dim mb-4">
          NO OPEN POSITIONS — bot is scanning the universe every tick, waiting for a pullback + Kronos-confirmed setup.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {state.openPositions.map((p) => (
            <PositionCard key={p.symbol} p={p} stopPct={state.stopPct} targetPct={state.targetPct} />
          ))}
        </div>
      )}

      <OrderLog orders={state.orderLog} />
    </>
  );
}
