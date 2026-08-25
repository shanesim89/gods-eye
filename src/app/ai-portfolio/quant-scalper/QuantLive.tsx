"use client";
import { QuantEquityChart, type EquityPoint } from "./QuantEquityChart";
import { useLiveState } from "../_components/useLiveState";
import type { QuantState } from "./types";

function usd(v: number, dec = 0): string {
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })}`;
}

function gateColor(v: string): string {
  if (v.startsWith("PASS")) return "text-green border-green/40";
  if (v.startsWith("LOCKED")) return "text-dim border-border";
  if (v.startsWith("PENDING")) return "text-amber border-amber/40";
  return "text-amber border-amber/40";
}

function circuitColor(s: string): string {
  if (s === "NORMAL") return "text-green";
  if (s === "REALLOCATED") return "text-amber";
  if (s === "RESUME") return "text-cyan";
  return "text-red";
}

function regimeColor(r: string): string {
  if (r === "trending") return "text-green";
  if (r === "crisis") return "text-red";
  if (r === "ranging") return "text-cyan";
  return "text-dim";
}

export function QuantLive({ initial }: { initial: QuantState }) {
  const { state, secsAgo, updatedAt } = useLiveState<QuantState>("quant:scrap:state", initial);

  const pnl = state.equity - state.starting_balance;
  const pnlPct = (pnl / state.starting_balance) * 100;
  const curve: EquityPoint[] = (state.history ?? []).map((h) => ({
    date: h.date.slice(5),
    equity: h.equity,
  }));

  const positions =
    state.top_positions ??
    Object.entries(state.weights ?? {})
      .filter(([, w]) => Math.abs(w) > 0.005)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 10)
      .map(([symbol, weight]) => ({ symbol, weight }));

  const gateRows: [string, string][] = [
    ["RESEARCH", state.gates.research],
    ...(state.gates.backtest_v3
      ? [["BACKTEST v3", state.gates.backtest_v3] as [string, string]]
      : []),
    ...(state.gates.backtest_v4
      ? [["BACKTEST v4", state.gates.backtest_v4] as [string, string]]
      : []),
    ...(state.gates.backtest && !state.gates.backtest_v3
      ? [["BACKTEST", state.gates.backtest] as [string, string]]
      : []),
    ["PAPER FORWARD", state.gates.paper],
    ["LIVE MICRO", state.gates.live],
  ];

  const sleeveEntries = Object.entries(state.sleeve_weights ?? {});
  const allocState = state.allocator;
  const priceEntries = Object.entries(state.prices ?? {}).slice(0, 10);
  const grossExposure = positions.reduce((s, p) => s + Math.abs(p.weight), 0);
  const stale = secsAgo > 90;

  return (
    <>
      {/* Paper bot publication health */}
      <div className="flex items-center gap-2 mb-2 text-[12px]">
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
            <span className="text-[12px] tracking-[1.5px] text-amber font-bold">
              ◆ {state.stage}
            </span>
            {state.regime && (
              <span className={`text-[12px] uppercase tracking-[1px] ${regimeColor(state.regime)}`}>
                {state.regime}
              </span>
            )}
            {state.circuit_state && (
              <span className={`text-[12px] uppercase tracking-[1px] ${circuitColor(state.circuit_state)}`}>
                ⬡ {state.circuit_state}
              </span>
            )}
          </div>
          <span className="text-[12px] text-dim">
            {state.last_run
              ? `last run ${state.last_run.slice(0, 16).replace("T", " ")} UTC`
              : "paper bot not yet run"}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
          <div>
            <div className="text-[32px] font-bold tabular-nums text-amber leading-none">
              {usd(state.equity, 2)}
            </div>
            <div className={`text-[13px] mt-1 ${pnl >= 0 ? "text-green" : "text-red"}`}>
              {pnl >= 0 ? "+" : ""}
              {usd(pnl, 2)} ({pnlPct >= 0 ? "+" : ""}
              {pnlPct.toFixed(2)}%) paper
              {state.daily_ret_pct !== undefined && (
                <span className={`ml-3 ${state.daily_ret_pct >= 0 ? "text-green" : "text-red"}`}>
                  today {state.daily_ret_pct >= 0 ? "+" : ""}
                  {state.daily_ret_pct.toFixed(2)}%
                </span>
              )}
            </div>
          </div>
          <div className="text-[12px] text-muted leading-relaxed max-w-md">
            {state.strategy}
          </div>
        </div>
      </div>

      {/* Observing — what it's watching now (multi-asset: live prices across the tracked universe) */}
      <div className="border border-cyan/30 bg-grid p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-cyan text-[12px] uppercase tracking-[1.5px]">◉ OBSERVING</div>
          <div className="text-[12px] text-dim tabular-nums">
            {priceEntries.length} symbols tracked · {(grossExposure * 100).toFixed(0)}% gross exposure
          </div>
        </div>
        {priceEntries.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {priceEntries.map(([symbol, price]) => {
              const w = (state.weights ?? {})[symbol] ?? 0;
              return (
                <div key={symbol} className="border border-border bg-bg/40 px-2 py-1.5 min-w-[92px]">
                  <div className="text-dim text-[10px] tracking-[1px]">{symbol.split("/")[0]}</div>
                  <div className="text-cyan font-bold tabular-nums text-[13px]">
                    ${price.toLocaleString("en-US", { maximumFractionDigits: price < 10 ? 4 : 2 })}
                  </div>
                  {Math.abs(w) > 0.005 && (
                    <div className={`text-[10px] font-bold ${w >= 0 ? "text-green" : "text-red"}`}>
                      {w >= 0 ? "L" : "S"} {(Math.abs(w) * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-dim text-[12px] italic py-2">
            Awaiting first publish — the paper bot fills this once it processes a live tick.
          </div>
        )}
      </div>

      {/* Backtest stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 text-[12px]">
        {[
          ["OOS SHARPE", state.backtest_stats.oos_sharpe.toFixed(2)],
          ["OOS ANN", `${state.backtest_stats.oos_ann_pct.toFixed(1)}%`],
          ["OOS MAX DD", `${state.backtest_stats.oos_dd_pct.toFixed(1)}%`],
          ["FULL SHARPE", state.backtest_stats.full_sharpe.toFixed(2)],
          ["HISTORY", `${state.backtest_stats.full_years.toFixed(1)}y`],
        ].map(([k, v]) => (
          <div key={k} className="border border-border bg-grid p-2">
            <div className="text-dim text-[12px] tracking-[1px]">{k}</div>
            <div className="text-cyan font-bold tabular-nums text-[15px]">{v}</div>
          </div>
        ))}
      </div>
      {state.backtest_stats.note && (
        <div className="text-[12px] text-dim mb-3 italic">{state.backtest_stats.note}</div>
      )}

      {/* Equity curve */}
      <div className="border border-border bg-grid p-3 mb-3">
        <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">
          PAPER EQUITY CURVE
        </div>
        <QuantEquityChart data={curve} />
      </div>

      {/* Sleeve allocation + leverage */}
      {(sleeveEntries.length > 0 || allocState) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          {sleeveEntries.length > 0 && (
            <div className="border border-border bg-grid p-3">
              <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">
                SLEEVE ALLOCATION
              </div>
              <table className="w-full text-[13px]">
                <tbody>
                  {sleeveEntries.map(([sleeve, w]) => (
                    <tr key={sleeve} className="dotted-row">
                      <td className="py-1 text-white font-bold uppercase">{sleeve}</td>
                      <td className="py-1 text-right text-muted text-[12px]">
                        {sleeve === "tsmom"
                          ? "Trend (GARCH+OI)"
                          : sleeve === "xsmom"
                          ? "Cross-sect L/S"
                          : sleeve === "carry"
                          ? "Funding harvest"
                          : sleeve === "ml_alpha"
                          ? "ML alpha (GBDT)"
                          : sleeve === "meanrev"
                          ? "Daily MR fade"
                          : sleeve}
                      </td>
                      <td className="py-1 text-right text-amber tabular-nums">
                        {(w * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {allocState && (
            <div className="border border-border bg-grid p-3">
              <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">
                LEVERAGE STACK
              </div>
              <table className="w-full text-[13px]">
                <tbody>
                  {[
                    ["Kelly leverage", `${allocState.kelly_leverage.toFixed(2)}×`],
                    ["Vol scale", `${allocState.vol_scale.toFixed(2)}×`],
                    ["DD de-lever", `${(allocState.drawdown_scale * 100).toFixed(0)}%`],
                    ["Corr brake", `${(allocState.corr_brake * 100).toFixed(0)}%`],
                    ["Net gross", `${allocState.leverage_scale.toFixed(2)}×`],
                  ].map(([k, v]) => (
                    <tr key={k} className="dotted-row">
                      <td className="py-0.5 text-dim">{k}</td>
                      <td
                        className={`py-0.5 text-right tabular-nums font-bold ${
                          k === "Net gross" ? "text-amber" : "text-muted"
                        }`}
                      >
                        {v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Positions + gate ladder */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">
            TOP POSITIONS
          </div>
          {positions.length > 0 ? (
            <table className="w-full text-[13px]">
              <tbody>
                {positions.map(({ symbol, weight }) => (
                  <tr key={symbol} className="dotted-row">
                    <td className="py-1 text-white font-bold">{symbol.split("/")[0]}</td>
                    <td
                      className={`py-1 text-right tabular-nums font-bold ${
                        weight >= 0 ? "text-green" : "text-red"
                      }`}
                    >
                      {weight >= 0 ? "L" : "S"} {(Math.abs(weight) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-dim text-[12px] italic py-2">
              All sleeves FLAT — no signal above threshold. Capital in cash.
            </div>
          )}
        </div>

        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">
            GATE LADDER
          </div>
          <div className="space-y-1.5">
            {gateRows.map(([stage, status]) => (
              <div key={stage} className="flex items-start gap-2 text-[12px]">
                <span
                  className={`px-1.5 py-0.5 border whitespace-nowrap ${gateColor(status)}`}
                >
                  {stage}
                </span>
                <span className="text-dim leading-snug pt-0.5">{status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Decisions */}
      <div className="border border-border bg-grid p-3 mb-3">
        <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">DECISIONS</div>
        <div className="mb-3">
          {positions.length > 0 ? (
            <div className="text-[14px] font-bold text-green">
              ▶ {positions.length} sleeve{positions.length === 1 ? "" : "s"} active
              <span className="text-dim font-normal"> · {(grossExposure * 100).toFixed(0)}% gross exposure</span>
            </div>
          ) : (
            <div className="text-[14px] font-bold text-dim">
              ▪ FLAT <span className="font-normal">— no sleeve signal above threshold, capital in cash</span>
            </div>
          )}
        </div>
        <div className="text-dim text-[12px] mb-1 uppercase tracking-[1px]">RECENT REBALANCE DECISIONS</div>
        {(state.recent_decisions ?? []).length > 0 ? (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-dim text-[12px] uppercase tracking-[1px]">
                <td className="py-1">Date</td>
                <td className="py-1">Symbol</td>
                <td className="py-1">Action</td>
                <td className="py-1 text-right">Weight</td>
                <td className="py-1 text-right">Price</td>
              </tr>
            </thead>
            <tbody>
              {(state.recent_decisions ?? []).slice(0, 15).map((d, i) => (
                <tr key={`${d.ts}-${d.symbol}-${i}`} className="dotted-row">
                  <td className="py-1 text-dim tabular-nums whitespace-nowrap">{d.ts.slice(0, 10)}</td>
                  <td className="py-1 text-white font-bold">{d.symbol.split("/")[0]}</td>
                  <td
                    className={`py-1 uppercase font-bold ${
                      d.action === "close" || d.action === "reduce" ? "text-red" : "text-green"
                    }`}
                  >
                    {d.action}
                  </td>
                  <td className="py-1 text-right tabular-nums text-muted">
                    {((d.prev_w ?? 0) * 100).toFixed(1)}% → {(d.weight * 100).toFixed(1)}%
                  </td>
                  <td className="py-1 text-right tabular-nums text-dim">
                    {d.price != null ? `$${d.price.toLocaleString("en-US")}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-dim text-[12px] italic py-2">
            No rebalance crossed the 0.5% threshold recently — positions held steady.
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="border border-border/40 bg-grid p-3 text-[12px] text-dim leading-relaxed">
        <span className="text-muted">◎ HOW IT WORKS (v4)</span> — Four uncorrelated return
        streams: <strong className="text-muted">TSMOM++</strong> (multi-lookback trend,
        GARCH vol sizing, OI confirmation), <strong className="text-muted">XSMOM</strong>{" "}
        (cross-sectional long/short — earns in bear markets from dispersion),{" "}
        <strong className="text-muted">Carry</strong> (harvest perp funding rate spread,
        market-neutral), <strong className="text-muted">MeanRev</strong> (fade daily
        overextensions in range regimes). Risk-parity allocator + fractional-Kelly
        leverage. Drawdown de-lever at −15% equity from peak → flat at −30%.
        3-loss adaptive circuit breaker: halt → de-risk → reallocate toward
        regime-appropriate sleeve → resume after 3 green days. Every stage gated;
        live execution stays LOCKED until combined backtest + 4 weeks paper pass.
        Not financial advice.
      </div>
    </>
  );
}
