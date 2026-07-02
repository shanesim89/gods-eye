"use client";
import { useLivePoll } from "../_components/useLivePoll";
import { OptionsStrikeChart, type StrikeLevel } from "../_components/OptionsStrikeChart";
import { OptionsKillSwitch } from "./OptionsKillSwitch";
import { OptionCard, type OptionCardRow, type OpenPosition } from "./OptionCard";
import { OptionsStrategyThesis, type UnderlyingThesis } from "./OptionsStrategyThesis";
import { OptionsTotalSummary } from "./OptionsTotalSummary";
import { OptionsOrderLog } from "./OptionsOrderLog";
import type { OptionsDashboardData } from "@/lib/trading/options-dashboard";

function usd(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function toDatedRows(data: OptionsDashboardData): OptionCardRow[] {
  return data.rows.map((r) => ({
    ...r,
    nextRun: r.nextRun ? new Date(r.nextRun) : null,
    openPositions: r.openPositions.map((p): OpenPosition => ({ ...p, expiry: new Date(p.expiry) })),
  }));
}

function toDatedThesis(data: OptionsDashboardData): UnderlyingThesis[] {
  return data.thesisUnderlyings.map((t) => ({ ...t, nextRun: t.nextRun ? new Date(t.nextRun) : null }));
}

export function OptionsLive({ initial }: { initial: OptionsDashboardData }) {
  const { state, secsAgo, updatedAt } = useLivePoll<OptionsDashboardData>(
    "/api/ai-portfolio/options/state",
    initial,
  );

  const collateralPct = state.maxCollateral > 0 ? Math.min(100, (state.totalCollateral / state.maxCollateral) * 100) : 0;
  const rows = toDatedRows(state);
  const thesisUnderlyings = toDatedThesis(state);
  const cryptoRows = state.rows.filter((r) => r.assetClass === "crypto" && (state.candles[r.underlying]?.length ?? 0) > 1);
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

      {/* PAPER banner */}
      <div style={{ background: "rgba(255,207,74,.06)", border: "1px solid rgba(255,207,74,.35)", padding: "10px 14px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ fontSize: 14, color: "#ffcf4a", flexShrink: 0 }}>⚠</span>
        <div style={{ fontSize: 12, color: "#ffcf4a", lineHeight: 1.6 }}>
          <strong>PAPER TRADING — SIMULATED ONLY.</strong> No real money is moved. Premiums, strikes, and P&amp;L are calculated using Black-Scholes from live spot prices. Use this to learn and validate the strategy before connecting a real broker.
        </div>
      </div>

      <OptionsTotalSummary
        data={{
          premiumIncome: state.totalPremiumIncome,
          realizedPnl: state.totalPnl,
          collateralReserved: state.totalCollateral,
          maxCollateral: state.maxCollateral,
          openCount: state.totalOpenCount,
          alloc: state.alloc,
        }}
      />

      {/* OPTIONS 101 explainer */}
      <details style={{ marginBottom: 16, border: "1px solid rgba(64,200,224,.15)", background: "rgba(70,224,245,.02)" }}>
        <summary style={{ padding: "8px 14px", fontSize: 9, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", cursor: "pointer", userSelect: "none" }}>
          OPTIONS 101 — HOW THIS MAKES MONEY, IN PLAIN ENGLISH ▸
        </summary>
        <div style={{ padding: "10px 14px 14px", fontSize: 12, color: "#bfe9f2", lineHeight: 1.8, borderTop: "1px solid rgba(64,200,224,.1)" }}>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ color: "#ffcf4a" }}>The one-sentence version:</strong> this bot gets <em>paid</em> to
            place limit orders. Instead of waiting to buy a stock at a lower price for free, it sells someone a
            promise to buy at that price — and pockets cash (the &quot;premium&quot;) whether the order fills or not.
          </p>
          <p style={{ marginBottom: 8 }}><strong style={{ color: "#ffcf4a" }}>The Wheel — a simple 3-step loop:</strong></p>
          <ol style={{ paddingLeft: 18, marginBottom: 8 }}>
            <li style={{ marginBottom: 4 }}><strong>Get paid to wait.</strong> Sell a put = promise to buy (e.g. SPY) if it drops to a price you already like. Collect cash today. Most weeks the price never drops that far — keep the cash, repeat.</li>
            <li style={{ marginBottom: 4 }}><strong>If it does drop — you buy at your price.</strong> That was the plan anyway. The premium you already collected makes your real cost even lower.</li>
            <li style={{ marginBottom: 4 }}><strong>Get paid while holding.</strong> Now sell a call = promise to sell your shares at a higher price. Collect more cash. If price rises there — sold at a profit, back to step 1.</li>
          </ol>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ color: "#ff5470" }}>What can go wrong:</strong> the asset keeps falling after you buy it
            (you own it cheaper than market, but it can fall further), or it rockets far above your call strike (you
            still profit, but miss the extra upside). What <em>cannot</em> happen: unlimited loss — every promise is
            fully backed by cash or shares.
          </p>
          <p>
            <strong style={{ color: "#ffcf4a" }}>Council long plays (the side bet):</strong> when the 4-agent council
            is very confident about direction, the bot buys a small option as a directional bet — like a lottery
            ticket with capped cost. Max loss = the small premium paid, never more.
          </p>
        </div>
      </details>

      {/* control bar */}
      <div className="flex flex-wrap items-center gap-4 mb-4 border border-border bg-grid p-3">
        <div className="flex items-center gap-2">
          <span className="text-muted text-[12px] uppercase tracking-[1px]">STATUS</span>
          <OptionsKillSwitch initialKillSwitch={initial.killSwitch} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex justify-between text-[12px] uppercase tracking-[1px] mb-1">
            <span className="text-muted">COLLATERAL USED</span>
            <span className="text-amber tabular-nums">{usd(state.totalCollateral, 0)} / {usd(state.maxCollateral, 0)}</span>
          </div>
          <div className="h-1.5 bg-black border border-border">
            <div className={`h-full ${collateralPct >= 100 ? "bg-red" : "bg-amber"}`} style={{ width: `${collateralPct}%` }} />
          </div>
        </div>
        <div className="text-[12px] text-dim uppercase tracking-[1px]">
          Δ TARGET {state.targetDelta}% · DTE {state.dteMin}–{state.dteMax} · CADENCE 7D · CONVICTION {state.convictionThreshold}%
        </div>
        <div className="text-[12px] tabular-nums">
          <span className="text-muted uppercase tracking-[1px] mr-2">TOTAL P&amp;L</span>
          <span className={state.totalPnl >= 0 ? "text-green" : "text-red"}>{usd(state.totalPnl, 0)}</span>
        </div>
      </div>

      {state.lastAlert && (
        <div className="border border-red/60 bg-red/5 text-red px-3 py-1.5 mb-4 text-[12px] tracking-[0.5px]">
          ⚠ {state.lastAlert}
        </div>
      )}

      <OptionsStrategyThesis
        convictionThreshold={state.convictionThreshold}
        targetDelta={state.targetDelta}
        dteMin={state.dteMin}
        dteMax={state.dteMax}
        longPlayBudget={state.longPlayBudget}
        longPlayEnabled={state.longPlayEnabled}
        collateralPerContract={state.collateralPerContract}
        maxCollateral={state.maxCollateral}
        underlyings={thesisUnderlyings}
      />

      {/* Price action — strike lines vs spot, crypto underlyings only (no free equity OHLC provider wired) */}
      {cryptoRows.length > 0 && (
        <div className="border border-border bg-grid p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-muted text-[12px] uppercase tracking-[1px]">PRICE ACTION · ~4D CANDLES</div>
            <div className="flex items-center gap-3 text-[10px] text-dim">
              <span><span className="text-red">┄</span> call strike</span>
              <span><span className="text-green">┄</span> put strike</span>
              <span><span className="text-amber">┄</span> now</span>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {cryptoRows.map((r) => {
              const levels: StrikeLevel[] = r.openPositions.map((p) => ({
                strike: p.strike,
                optType: p.optType,
                side: p.side,
                label: `${p.side === "short" ? "SHORT" : "LONG"} ${p.optType} ${p.strike} · ${p.dte}d`,
              }));
              return (
                <div key={r.underlying}>
                  <div className="text-[12px] font-bold mb-1 text-amber">{r.underlying}</div>
                  <OptionsStrikeChart
                    bars={state.candles[r.underlying] ?? []}
                    levels={levels}
                    lastPrice={r.spot}
                    height={180}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        {rows.map((row: OptionCardRow) => (
          <OptionCard key={row.underlying} row={row} />
        ))}
      </div>

      <OptionsOrderLog orders={state.orderLog} />
    </>
  );
}
