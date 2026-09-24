"use client";
import { useLiveState } from "../_components/useLiveState";
import type { LeveragedState, LeveragedStats } from "./types";

function usd(v: number, dec = 2): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function toneForAction(a: string): string {
  if (a.startsWith("BUY")) return "text-green";
  if (a.startsWith("CLOSE")) return "text-red";
  if (a.startsWith("SKIP")) return "text-dim";
  return "text-muted";
}

function num(v: number | null | undefined, fmt: (n: number) => string): string {
  return v == null ? "—" : v === Infinity ? "∞" : fmt(v);
}

function statTiles(s: LeveragedStats): [string, string][] {
  return [
    ["TRADES", `${s.trades ?? 0}`],
    ["PROFIT FACTOR", num(s.profit_factor, (n) => n.toFixed(2))],
    ["EXPECTANCY R", num(s.expectancy_r, (n) => n.toFixed(3))],
    ["MAX DD", num(s.max_dd_pct, (n) => `${n.toFixed(1)}%`)],
    ["SHARPE (ann)", num(s.sharpe_ann, (n) => n.toFixed(2))],
  ];
}

export function LeveragedLive({ initial }: { initial: LeveragedState }) {
  const { state, secsAgo, updatedAt } = useLiveState<LeveragedState>("leveraged-nasdaq", initial);
  const stale = secsAgo > 90;
  const p = state.active_params;
  const openSymbols = Object.entries(state.open_position ?? {});

  return (
    <>
      {/* Publication health */}
      <div className="flex items-center gap-2 mb-2 text-[12px]">
        <span className={`inline-flex items-center gap-1 ${stale ? "text-amber" : "text-green"}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${stale ? "bg-amber" : "bg-green animate-pulse"}`} />
          {stale ? "STALE" : "PAPER ACTIVE"}
        </span>
        <span className="text-dim">
          {updatedAt ? `updated ${secsAgo}s ago` : "polling every 20s"}
        </span>
      </div>

      {/* NO_TRADE — no params set has passed the gates, bot places no orders */}
      {!state.validated && (
        <div className="border border-red/40 bg-red/5 p-3 mb-3 text-[12px] text-red">
          🛑 NO_TRADE — no params set passed the walk-forward gates. The bot is
          halted: it publishes status only and places no orders. Params and
          backtest figures below are the last candidate on record, not what is
          (or ever was) live.
        </div>
      )}

      {/* Hero */}
      <div className="border border-cyan/40 bg-cyan/5 p-3 mb-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <span className="text-[12px] tracking-[1.5px] text-cyan font-bold">
            ◆ TQQQ / SQQQ · NASDAQ 3× MOMENTUM
          </span>
          <span className="text-[12px] text-dim">
            {state.market_open === false ? "market closed" : state.market_open === true ? "market open" : "—"}
            {state.last_run ? ` · last run ${state.last_run.slice(0, 16).replace("T", " ")} UTC` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
          <div>
            <div className="text-[32px] font-bold tabular-nums text-cyan leading-none">
              {usd(state.equity)}
            </div>
            <div className="text-[13px] mt-1 text-dim">
              shared paper account equity (w/ Universe bot) — not this bot&apos;s own book
            </div>
          </div>
          <div className="text-[12px] text-muted leading-relaxed max-w-md">
            {state.strategy}
          </div>
        </div>
      </div>

      {/* Backtest vs today */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">
            BACKTEST (in-sample candidate, cost stress {state.cost_stress ?? 1.5}×)
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            {statTiles(state.backtest_stats).map(([k, v]) => (
              <div key={k} className="border border-border bg-bg/40 p-2">
                <div className="text-dim text-[11px] tracking-[1px]">{k}</div>
                <div className="text-white font-bold tabular-nums text-[14px]">{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">TODAY</div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            {statTiles(state.session).map(([k, v]) => (
              <div key={k} className="border border-border bg-bg/40 p-2">
                <div className="text-dim text-[11px] tracking-[1px]">{k}</div>
                <div className="text-amber font-bold tabular-nums text-[14px]">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active params */}
      <div className="border border-border bg-grid p-3 mb-3">
        <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">ACTIVE PARAMS (best in-sample candidate)</div>
        <div className="flex flex-wrap gap-2 text-[12px]">
          {Object.entries(p).map(([k, v]) => (
            <div key={k} className="border border-border bg-bg/40 px-2 py-1">
              <span className="text-dim">{k}</span>{" "}
              <span className="text-white font-bold tabular-nums">{String(v)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Positions + pending */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">OPEN POSITION</div>
          {openSymbols.length > 0 ? (
            <table className="w-full text-[13px]">
              <tbody>
                {openSymbols.map(([symbol, pos]) => (
                  <tr key={symbol} className="dotted-row align-top">
                    <td className="py-1 text-white font-bold">{symbol}</td>
                    <td className="py-1 text-right text-dim text-[11px]">
                      {Object.entries(pos).map(([k, v]) => `${k} ${v}`).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-dim text-[12px] italic py-2">Flat — no open position.</div>
          )}
          {state.pending.length > 0 && (
            <div className="mt-2 text-[12px] text-amber">pending: {state.pending.join(", ")}</div>
          )}
        </div>

        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">RECENT SKIPS</div>
          {state.skips.length > 0 ? (
            <table className="w-full text-[12px]">
              <tbody>
                {state.skips.slice(-10).reverse().map(([ts, symbol, reason], i) => (
                  <tr key={`${ts}-${i}`} className="dotted-row">
                    <td className="py-1 text-dim tabular-nums whitespace-nowrap">{ts.slice(11, 19)}</td>
                    <td className="py-1 text-white font-bold">{symbol}</td>
                    <td className="py-1 text-right text-dim">{reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-dim text-[12px] italic py-2">No skips logged.</div>
          )}
        </div>
      </div>

      {/* Actions log */}
      <div className="border border-border bg-grid p-3 mb-3">
        <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">LAST POLL ACTIONS</div>
        {state.actions.length > 0 ? (
          <div className="space-y-1 text-[12px]">
            {state.actions.map((a, i) => (
              <div key={i} className={toneForAction(a)}>▸ {a}</div>
            ))}
          </div>
        ) : (
          <div className="text-dim text-[12px] italic py-2">No reconciliation actions on the last poll.</div>
        )}
      </div>

      {/* How it works */}
      <div className="border border-border/40 bg-grid p-3 text-[12px] text-dim leading-relaxed">
        <span className="text-muted">◎ HOW IT WORKS</span> — QQQ EMA cross sets a
        bias (up → TQQQ eligible, down → SQQQ eligible; QQQ itself is never
        traded). Entry needs a breakout above the rolling high plus a
        range-expansion filter, fill at the next bar&apos;s open. Exits in order:
        gap-through-fill rejection, TP1 (partial), stop, breakeven ratchet after
        TP1, time stop, hard EOD flatten. Position size is capped at{" "}
        {(0.5 * 3).toFixed(1)}× effective notional on this 3× ETF, one direction
        at a time. Live execution replays the exact backtest engine against
        today&apos;s bars — no separate live signal path. Not financial advice.
      </div>
    </>
  );
}
