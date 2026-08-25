"use client";
import { QuantEquityChart, type EquityPoint } from "../quant-scalper/QuantEquityChart";
import { useLiveState } from "./useLiveState";
import { PriceActionChart } from "./PriceActionChart";
import { ObservingPanel } from "./ObservingPanel";
import { DecisionsFeed } from "./DecisionsFeed";
import type { GoldState } from "./types";

function usd(v: number, dec = 0): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}
function regimeColor(r?: string): string {
  if (r === "trending" || r === "crisis") return "text-red";
  if (r === "ranging") return "text-green";
  return "text-dim";
}
function circuitColor(s?: string): string {
  if (s === "NORMAL") return "text-green";
  if (s === "REALLOCATED" || s === "RESUME") return "text-amber";
  return "text-red";
}
function gateColor(v: string): string {
  if (v.toUpperCase().startsWith("PASS") || v.startsWith("FORWARD")) return "text-green border-green/40";
  if (v.startsWith("LOCKED")) return "text-dim border-border";
  return "text-amber border-amber/40";
}

export function GoldLive({ initial, stateKey = "gold:scalper:state" }: { initial: GoldState; stateKey?: string }) {
  const { state, secsAgo, updatedAt } = useLiveState<GoldState>(stateKey, initial);

  const pnl = state.equity - state.starting_balance;
  const pnlPct = (pnl / state.starting_balance) * 100;
  const curve: EquityPoint[] = (state.history ?? []).map((h) => ({ date: h.date.slice(5), equity: h.equity }));
  const sess = state.session ?? { trades: 0, win_rate: null, profit_factor: null, pnl: 0 };
  const params = Object.entries(state.active_params ?? {});
  const bt = state.backtest_stats ?? {};
  const pos = state.open_position ?? null;
  const recentTrades = state.recent_trades ?? [];
  const bars = state.recent_bars ?? [];
  const skips = state.gates?.overall_paper?.skips as Record<string, number> | undefined;

  const gateRows: [string, string][] = [
    ["RESEARCH", String(state.gates?.research ?? "pending")],
    ["PAPER FORWARD", String(state.gates?.paper ?? "—")],
    ["LIVE", String(state.gates?.live ?? "LOCKED")],
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
            {state.regime && (
              <span className={`text-[14px] uppercase tracking-[1px] ${regimeColor(state.regime)}`}>{state.regime}</span>
            )}
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
      <ObservingPanel observing={state.observing} />

      {/* Price action — the centerpiece */}
      <div className="border border-border bg-grid p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-muted text-[14px] uppercase tracking-[1px]">PRICE ACTION · 1m · VWAP + fades</div>
          <div className="flex items-center gap-3 text-[13px] text-dim">
            <span><span className="text-amber">—</span> VWAP</span>
            <span><span className="text-green">▲</span> long <span className="text-red">▼</span> short</span>
            <span><span className="text-amber">┄</span> now</span>
          </div>
        </div>
        <PriceActionChart bars={bars} markers={recentTrades} lastPrice={state.observing?.price} />
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

      {/* Open position + active params */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[14px] mb-2 uppercase tracking-[1px]">OPEN POSITION</div>
          {pos ? (
            <table className="w-full text-[15px]">
              <tbody>
                <tr className="dotted-row">
                  <td className="py-1 text-dim">Side</td>
                  <td className={`py-1 text-right font-bold ${pos.direction > 0 ? "text-green" : "text-red"}`}>
                    {pos.direction > 0 ? "LONG (fade down)" : "SHORT (fade up)"}
                  </td>
                </tr>
                <tr className="dotted-row">
                  <td className="py-1 text-dim">Entry</td>
                  <td className="py-1 text-right tabular-nums text-muted">{usd(pos.entry, 2)}</td>
                </tr>
                <tr className="dotted-row">
                  <td className="py-1 text-dim">Stretch at entry</td>
                  <td className="py-1 text-right tabular-nums text-amber">{pos.stretch.toFixed(2)}σ</td>
                </tr>
                <tr className="dotted-row">
                  <td className="py-1 text-dim">Size (oz)</td>
                  <td className="py-1 text-right tabular-nums text-muted">{pos.size.toFixed(4)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="text-dim text-[14px] italic py-2">
              FLAT — no fade above threshold. Waiting for a ranging-session 3σ stretch.
            </div>
          )}
        </div>

        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[14px] mb-2 uppercase tracking-[1px]">ACTIVE PARAMS · SELF-TUNED</div>
          {params.length > 0 ? (
            <table className="w-full text-[15px]">
              <tbody>
                {params.map(([k, v]) => (
                  <tr key={k} className="dotted-row">
                    <td className="py-1 text-dim">{k}</td>
                    <td className="py-1 text-right tabular-nums text-muted">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-dim text-[14px] italic py-2">
              Defaults in use — nightly walk-forward optimizer has not promoted new params yet.
            </div>
          )}
          {(bt.oos_sharpe != null || bt.win_rate != null) && (
            <div className="text-[14px] text-dim mt-2 pt-2 border-t border-border/40">
              backtest: {bt.oos_sharpe != null && `OOS Sharpe ${bt.oos_sharpe.toFixed(2)} · `}
              {bt.win_rate != null && `WR ${(bt.win_rate * 100).toFixed(0)}% · `}
              {bt.profit_factor != null && `PF ${bt.profit_factor.toFixed(2)} · `}
              {bt.oos_dd_pct != null && `DD ${bt.oos_dd_pct.toFixed(1)}%`}
            </div>
          )}
        </div>
      </div>

      {/* Decisions */}
      <DecisionsFeed openPosition={pos} recentTrades={recentTrades} skips={skips} />

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
        <span className="text-muted">◎ HOW IT WORKS</span> — Fades extreme stretches from the session VWAP on
        XAUUSD 1m, long AND short. Win rate is stacked from independent gates:{" "}
        <strong className="text-muted">3σ stretch</strong>, <strong className="text-muted">ranging regime</strong>{" "}
        (fades die in trends), <strong className="text-muted">spread-room</strong>, {" "}
        <strong className="text-muted">London/NY session</strong>, and optional{" "}
        <strong className="text-muted">Kronos forecast</strong> + <strong className="text-muted">council macro bias</strong>.
        Losses are cut by Monte-Carlo worst-case sizing + a time stop + daily/weekly loss caps + a 3-loss circuit
        breaker — deliberately NOT tight per-trade stops. A nightly walk-forward optimizer re-tunes params
        out-of-sample and only promotes them if they beat a permutation null. Paper-forward; live execution stays
        LOCKED. Not financial advice.
      </div>
    </>
  );
}
