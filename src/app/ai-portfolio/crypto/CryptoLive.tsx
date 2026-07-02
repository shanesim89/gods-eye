"use client";
import { useLivePoll } from "../_components/useLivePoll";
import { TokenCandleChart } from "../_components/TokenCandleChart";
import { KillSwitch as KillSwitchClient } from "./KillSwitch";
import { HudCard, type TokenRow } from "./HudCard";
import { PortfolioSummary } from "./PortfolioSummary";
import { StrategyThesis } from "./StrategyThesis";
import { OrderLog } from "./OrderLog";
import { CouncilReasoning } from "./CouncilReasoning";
import { StrategyPlan } from "./StrategyPlan";
import { verdictColor } from "@/lib/council/display";
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
    nextRun: r.nextRun ? new Date(r.nextRun) : null,
    lastOrder: r.lastOrder ? { ...r.lastOrder, date: new Date(r.lastOrder.date) } : null,
  }));
}

export function CryptoLive({ initial }: { initial: CryptoDashboardData }) {
  const { state, secsAgo, updatedAt } = useLivePoll<CryptoDashboardData>(
    "/api/ai-portfolio/crypto/state",
    initial,
  );

  const spentPct = state.cap > 0 ? Math.min(100, (state.spent / state.cap) * 100) : 0;
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
        <div className="flex-1 min-w-[200px]">
          <div className="flex justify-between text-[12px] uppercase tracking-[1px] mb-1">
            <span className="text-muted">MONTH SPEND</span>
            <span className="text-amber tabular-nums">{usd(state.spent)} / {usd(state.cap)}</span>
          </div>
          <div className="h-1.5 bg-black border border-border">
            <div className={`h-full ${spentPct >= 100 ? "bg-red" : "bg-amber"}`} style={{ width: `${spentPct}%` }} />
          </div>
        </div>
        <div className="text-[12px] text-dim uppercase tracking-[1px]">
          DCA {usd(state.dca, 0)} · BOOST {usd(state.boost, 0)} · MIN CONF {state.minConf}%
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
          {state.rows.map((r) => {
            const isOver = r.maxPrice != null && r.price != null && r.price > r.maxPrice;
            const vColor = verdictColor(r.verdict?.verdict);
            return (
              <div key={r.token} className="border border-border bg-bg/40 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold tracking-[1px]" style={{ color: TOKEN_COLOR[r.token] }}>{r.token}</span>
                  <span className="text-[10px] font-bold" style={{ color: vColor }}>{r.verdict?.verdict ?? "—"}</span>
                </div>
                <div className="text-cyan font-bold tabular-nums text-[15px]">{usd(r.price)}</div>
                <div className={`text-[10px] ${isOver ? "text-red" : "text-green"}`}>
                  {r.maxPrice == null ? "no ceiling" : isOver ? "over ceiling" : "under ceiling"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Price action — candles + buy fills + ceiling line, per token */}
      <div className="border border-border bg-grid p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-muted text-[12px] uppercase tracking-[1px]">PRICE ACTION · ~4D CANDLES</div>
          <div className="flex items-center gap-3 text-[10px] text-dim">
            <span><span className="text-green">▲</span> buy fill</span>
            <span><span className="text-red">┄</span> ceiling</span>
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
                maxPrice={r.maxPrice}
                lastPrice={r.price}
                height={180}
              />
            </div>
          ))}
        </div>
      </div>

      <StrategyThesis
        dca={state.dca}
        boost={state.boost}
        cap={state.cap}
        minConf={state.minConf}
        sellSkipThreshold={state.sellSkipThreshold}
        maxConsecutiveSkips={state.maxConsecutiveSkips}
        tokens={state.thesis}
      />

      <StrategyPlan rows={state.planRows} spent={state.spent} cap={state.cap} killSwitch={state.killSwitch} />

      <CouncilReasoning entries={state.reasoning} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {hudRows.map((row) => (
          <HudCard key={row.token} row={row} />
        ))}
      </div>

      <OrderLog orders={state.orderLog} planByToken={state.planByToken} />
    </>
  );
}
