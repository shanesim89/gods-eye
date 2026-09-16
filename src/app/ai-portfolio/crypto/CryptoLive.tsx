"use client";
import { useLivePoll } from "../_components/useLivePoll";
import { TokenCandleChart } from "../_components/TokenCandleChart";
import { KillSwitch as KillSwitchClient } from "./KillSwitch";
import { HudCard, type TokenRow } from "./HudCard";
import { PortfolioSummary } from "./PortfolioSummary";
import { StrategyThesis } from "./StrategyThesis";
import { OrderLog } from "./OrderLog";
import type { CryptoDashboardData } from "@/lib/trading/crypto-dashboard";

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

/** Wire rows use ISO strings for dates (JSON-safe); HudCard wants Date objects. */
function toHudRows(data: CryptoDashboardData): TokenRow[] {
  return data.rows.map((r) => ({
    ...r,
    lastOrder: r.lastOrder ? { ...r.lastOrder, date: new Date(r.lastOrder.date) } : null,
  }));
}

export function CryptoLive({ initial }: { initial: CryptoDashboardData }) {
  const { state, secsAgo, updatedAt } = useLivePoll<CryptoDashboardData>(
    "/api/ai-portfolio/crypto/state",
    initial,
  );

  const hudRows = toHudRows(state);
  const stale = secsAgo > 90;

  return (
    <>
      {/* Live badge */}
      <div className="flex items-center gap-2 mb-2 text-[12px]">
        <span className={`inline-flex items-center gap-1 ${stale ? "text-amber" : "text-green"}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${stale ? "bg-amber" : "bg-green animate-pulse"}`} />
          {stale ? "STALE" : "LIVE"}
        </span>
        <span className="text-dim">{updatedAt ? `updated ${secsAgo}s ago` : "polling every 20s"}</span>
      </div>

      {/* top control bar */}
      <div className="flex flex-wrap items-center gap-4 mb-4 border border-border bg-grid p-3">
        <div className="flex items-center gap-2">
          <span className="text-muted text-[12px] uppercase tracking-[1px]">STATUS</span>
          <KillSwitchClient initialKillSwitch={initial.killSwitch} />
        </div>
        <div className="text-[12px] text-dim uppercase tracking-[1px]">
          BUY {usd(state.buyUsd, 0)} on 8% DROP · MON–THU
        </div>
        <div className="text-[12px] text-dim uppercase tracking-[1px] ml-auto">
          SPENT MTD {usd(state.spent)}
        </div>
      </div>

      {state.lastAlert && (
        <div className="border border-red/60 bg-red/5 text-red px-3 py-1.5 mb-4 text-[12px] tracking-[0.5px]">
          ⚠ {state.lastAlert}
        </div>
      )}

      <style>{`
        @keyframes blip{0%,100%{opacity:1}50%{opacity:.2}}
        .live-blip{animation:blip 1.4s ease-in-out infinite}
      `}</style>

      <PortfolioSummary
        totalValue={state.totalValue}
        totalCost={state.totalCost}
        totalPnl={state.totalPnl}
        totalPnlPct={state.totalPnlPct}
        alloc={state.alloc}
        breakdown={state.breakdown}
      />

      {/* Observing — at-a-glance live scan across the tracked universe */}
      <div className="border border-cyan/30 bg-grid p-3 mb-4">
        <div className="text-cyan text-[12px] uppercase tracking-[1.5px] mb-2">◉ OBSERVING</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {state.rows.map((r) => (
            <div key={r.token} className="border border-border bg-bg/40 p-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-[1px]" style={{ color: TOKEN_COLOR[r.token] }}>{r.token}</span>
                <span className={`text-[10px] font-bold ${r.armed ? "text-green" : "text-dim"}`}>
                  {r.armed ? "ARMED" : "WATCHING"}
                </span>
              </div>
              <div className="text-cyan font-bold tabular-nums text-[15px]">{usd(r.price)}</div>
              <div className={`text-[10px] ${r.armed ? "text-green" : "text-dim"}`}>
                {r.dropPct == null ? "no data" : r.dropPct >= 0 ? `${r.dropPct.toFixed(1)}% below high` : `${Math.abs(r.dropPct).toFixed(1)}% above high`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Price action — candles + buy fills + 7d-high line, per token */}
      <div className="border border-border bg-grid p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-muted text-[12px] uppercase tracking-[1px]">PRICE ACTION · ~4D CANDLES</div>
          <div className="flex items-center gap-3 text-[10px] text-dim">
            <span><span className="text-green">▲</span> buy fill</span>
            <span><span className="text-red">┄</span> 7d high</span>
            <span><span className="text-amber">┄</span> now</span>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {state.rows.map((r) => (
            <div key={r.token}>
              <div className="text-[12px] font-bold mb-1" style={{ color: TOKEN_COLOR[r.token] }}>{r.token}</div>
              <TokenCandleChart
                bars={state.candles[r.token] ?? []}
                orders={state.orderLog.filter((o) => o.token === r.token)}
                high7d={r.high7d}
                lastPrice={r.price}
                height={180}
              />
            </div>
          ))}
        </div>
      </div>

      <StrategyThesis
        buyUsd={state.buyUsd}
        tokens={state.rows.map((r) => ({ token: r.token, price: r.price, high7d: r.high7d, dropPct: r.dropPct, armed: r.armed }))}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {hudRows.map((row) => (
          <HudCard key={row.token} row={row} />
        ))}
      </div>

      <OrderLog orders={state.orderLog} />
    </>
  );
}
