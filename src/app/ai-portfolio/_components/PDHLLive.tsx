"use client";
import { QuantEquityChart, type EquityPoint } from "../quant-scalper/QuantEquityChart";
import { useLiveState } from "./useLiveState";
import { PDHLPriceActionChart } from "./PDHLPriceActionChart";
import { PDHLObservingPanel } from "./PDHLObservingPanel";
import { PDHLDecisionsFeed } from "./PDHLDecisionsFeed";
import type { PDHLState } from "./types";

function usd(v: number, dec = 0): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}
function circuitColor(s?: string): string {
  if (s === "NORMAL") return "text-green";
  if (s === "REALLOCATED" || s === "RESUME") return "text-amber";
  return "text-red";
}
function gateColor(v: string): string {
  if (v.toUpperCase().startsWith("PASS") || v.startsWith("FORWARD") || v.includes("walk-forward pass"))
    return "text-green border-green/40";
  if (v.startsWith("LOCKED")) return "text-dim border-border";
  return "text-amber border-amber/40";
}

export function PDHLLive({ initial, stateKey = "gold:pdhl:state" }: { initial: PDHLState; stateKey?: string }) {
  const { state, secsAgo, updatedAt } = useLiveState<PDHLState>(stateKey, initial);

  const pnl = state.equity - state.starting_balance;
  const pnlPct = (pnl / state.starting_balance) * 100;
  const curve: EquityPoint[] = (state.history ?? []).map((h) => ({ date: h.date.slice(5), equity: h.equity }));
  const sess = state.session ?? { trades: 0, win_rate: null, profit_factor: null, pnl: 0 };
  const gates = state.gates ?? {};
  const overall = gates.overall_paper;
  const pos = state.open_position ?? null;
  const recentTrades = state.recent_trades ?? [];
  const bars = state.recent_bars ?? [];
  const skips = gates.overall_paper?.skips;

  const gateRows: [string, string][] = [
    ["RESEARCH", String(gates.research ?? "pending")],
    ["PAPER FORWARD", String(gates.paper ?? "—")],
    ["LIVE", String(gates.live ?? "LOCKED")],
  ];

  const stale = secsAgo > 90;

  return (
    <>
      {/* Paper bot publication health */}
      <div className="flex items-center gap-2 mb-2 text-[14px]">
        <span className={`inline-flex items-center gap-1 ${stale ? "text-amber" : "text-green"}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${stale ? "bg-amber" : "bg-green animate-pulse"}`} />
          {stale ? "STALE" : "PAPER ACTIVE"}
        </span>
        <span className="text-dim">
          {updatedAt ? `updated ${secsAgo}s ago` : "polling every 20s"}
        </span>
      </div>

      {/* Hero */}
      <div className="border border-amber/40 bg-amber/5 p-3 mb-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-3">
            <span className="text-[14px] tracking-[1.5px] text-amber font-bold">◆ {state.stage}</span>
            {state.circuit_state && (
              <span className={`text-[14px] uppercase tracking-[1px] ${circuitColor(state.circuit_state)}`}>
                ⬡ {state.circuit_state}
              </span>
            )}
          </div>
          <span className="text-[14px] text-dim">
            {state.last_run
              ? `last run ${state.last_run.slice(0, 16).replace("T", " ")} UTC`
              : "paper bot not yet run"}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
          <div>
            <div className="text-[36px] font-bold tabular-nums text-amber leading-none">{usd(state.equity, 2)}</div>
            <div className={`text-[15px] mt-1 ${pnl >= 0 ? "text-green" : "text-red"}`}>
              {pnl >= 0 ? "+" : ""}{usd(pnl, 2)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%) paper
            </div>
          </div>
          <div className="text-[14px] text-muted leading-relaxed max-w-md">{state.strategy}</div>
        </div>
      </div>

      {/* Observing — what it's watching now */}
      <PDHLObservingPanel observing={state.observing} />

      {/* Price action — the centerpiece */}
      <div className="border border-border bg-grid p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-muted text-[14px] uppercase tracking-[1px]">
            PRICE ACTION · 1m · {state.observing?.period ?? "daily"} PDH/PDL
          </div>
          <div className="flex items-center gap-3 text-[13px] text-dim">
            <span><span className="text-cyan">┄</span> PDH</span>
            <span><span className="text-red">┄</span> PDL</span>
            <span><span className="text-green">▲</span> long <span className="text-red">▼</span> short</span>
            <span><span className="text-amber">┄</span> now</span>
          </div>
        </div>
        <PDHLPriceActionChart bars={bars} markers={recentTrades} lastPrice={state.observing?.price} />
      </div>

      {/* Today scorecard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-[14px]">
        {[
          ["TODAY TRADES", String(sess.trades)],
          ["WIN RATE", sess.win_rate == null ? "—" : `${(sess.win_rate * 100).toFixed(0)}%`],
          ["PROFIT FACTOR", sess.profit_factor == null ? "—" : sess.profit_factor.toFixed(2)],
          ["TODAY PnL", `${sess.pnl >= 0 ? "+" : ""}${usd(sess.pnl, 2)}`],
        ].map(([k, v]) => (
          <div key={k} className="border border-border bg-grid p-2">
            <div className="text-dim text-[14px] tracking-[1px]">{k}</div>
            <div className="text-cyan font-bold tabular-nums text-[17px]">{v}</div>
          </div>
        ))}
      </div>

      {/* Open position + overall paper stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[14px] mb-2 uppercase tracking-[1px]">OPEN POSITION</div>
          {pos ? (
            <table className="w-full text-[15px]">
              <tbody>
                <tr className="dotted-row">
                  <td className="py-1 text-dim">Side</td>
                  <td className={`py-1 text-right font-bold ${pos.direction > 0 ? "text-green" : "text-red"}`}>
                    {pos.direction > 0 ? "LONG (break above PDH)" : "SHORT (break below PDL)"}
                  </td>
                </tr>
                <tr className="dotted-row">
                  <td className="py-1 text-dim">Entry</td>
                  <td className="py-1 text-right tabular-nums text-muted">{usd(pos.entry, 2)}</td>
                </tr>
                <tr className="dotted-row">
                  <td className="py-1 text-dim">PDH/PDL level</td>
                  <td className="py-1 text-right tabular-nums text-cyan">{usd(pos.level, 2)}</td>
                </tr>
                <tr className="dotted-row">
                  <td className="py-1 text-dim">Size (oz)</td>
                  <td className="py-1 text-right tabular-nums text-muted">{pos.size.toFixed(4)}</td>
                </tr>
                <tr className="dotted-row">
                  <td className="py-1 text-dim">Scale-out</td>
                  <td className="py-1 text-right text-[14px]">
                    {pos.tp1_done ? (
                      <span className="text-green">
                        ◆ TP1 banked · runner {(pos.remaining ?? pos.size).toFixed(4)} oz · stop @ breakeven
                      </span>
                    ) : (
                      <span className="text-dim">full size · awaiting +1R partial</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="text-dim text-[14px] italic py-2">
              FLAT — no confirmed PDH/PDL break+retest in session window.
            </div>
          )}
        </div>

        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[14px] mb-2 uppercase tracking-[1px]">PAPER OVERALL STATS</div>
          {overall && overall.trades ? (
            <table className="w-full text-[15px]">
              <tbody>
                {[
                  ["Trades", String(overall.trades)],
                  ["Win rate", overall.win_rate != null ? `${(overall.win_rate * 100).toFixed(0)}%` : "—"],
                  ["Profit factor", overall.profit_factor != null ? overall.profit_factor.toFixed(3) : "—"],
                  ["Expectancy", overall.expectancy_R != null ? `${overall.expectancy_R.toFixed(3)}R` : "—"],
                  ["Total PnL", overall.total_pnl != null ? usd(overall.total_pnl, 2) : "—"],
                  ["Return", overall.return_pct != null ? `${overall.return_pct.toFixed(2)}%` : "—"],
                  ["Max DD", overall.max_dd_pct != null ? `${overall.max_dd_pct.toFixed(2)}%` : "—"],
                  ["Ann. Sharpe", overall.sharpe_ann != null ? overall.sharpe_ann.toFixed(3) : "—"],
                ].map(([k, v]) => (
                  <tr key={k} className="dotted-row">
                    <td className="py-1 text-dim">{k}</td>
                    <td className="py-1 text-right tabular-nums text-muted">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-dim text-[14px] italic py-2">
              No paper trades yet — stats will populate after first run.
            </div>
          )}
        </div>
      </div>

      {/* Decisions */}
      <PDHLDecisionsFeed openPosition={pos} recentTrades={recentTrades} skips={skips} />

      {/* Equity curve */}
      <div className="border border-border bg-grid p-3 mb-3">
        <div className="text-muted text-[14px] mb-2 uppercase tracking-[1px]">PAPER EQUITY CURVE</div>
        <QuantEquityChart data={curve} />
      </div>

      {/* Gate ladder */}
      <div className="border border-border bg-grid p-3 mb-3">
        <div className="text-muted text-[14px] mb-2 uppercase tracking-[1px]">GATE LADDER</div>
        <div className="space-y-1.5">
          {gateRows.map(([stage, status]) => (
            <div key={stage} className="flex items-start gap-2 text-[14px]">
              <span className={`px-1.5 py-0.5 border whitespace-nowrap ${gateColor(status)}`}>{stage}</span>
              <span className="text-dim leading-snug pt-0.5">{status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="border border-border/40 bg-grid p-3 text-[14px] text-dim leading-relaxed">
        <span className="text-muted">◎ HOW IT WORKS</span> — Trades confirmed breaks of the
        prior day&apos;s High (PDH) or Low (PDL) on XAUUSD 1m, long AND short. Entry requires a{" "}
        <strong className="text-muted">confirmed close-break</strong> (close &gt; PDH×1.0002 or &lt;
        PDL×0.9998), then a <strong className="text-muted">retest</strong> — bar low touches within
        0.03% of the level but close holds above/below. This filters false breakouts without
        requiring a second candle confirm. Exit: <strong className="text-muted">scale-out</strong> —
        bank half at <strong className="text-muted">+1R</strong>, move stop to{" "}
        <strong className="text-muted">breakeven</strong> (runner can&apos;t turn into a loss), run
        the rest to <strong className="text-muted">2.0R TP</strong>;{" "}
        <strong className="text-muted">structure SL</strong> (retest bar low ±0.2%),{" "}
        <strong className="text-muted">2h time stop</strong>. Sessions: London+NY (07–21 UTC only).
        Walk-forward validated: OOS Sharpe 5.0, max DD 1.4%, permutation p=0.079 (&lt;0.10 gate).
        Trending complement to the VWAP fade — trades momentum, not mean-reversion. Paper-forward;
        live execution stays LOCKED. Not financial advice.
      </div>
    </>
  );
}
