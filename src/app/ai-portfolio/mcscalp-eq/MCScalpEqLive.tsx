"use client";
import { useLiveState } from "../_components/useLiveState";
import type { MCScalpEqState } from "./types";

function usd(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

export function MCScalpEqLive({ initial }: { initial: MCScalpEqState }) {
  const { state, secsAgo, updatedAt } = useLiveState<MCScalpEqState>("mcscalp_eq:live:state", initial);
  // daily systemd timer (~00:30 UTC) — same staleness margin as quant-scalper.
  const stale = secsAgo > 36 * 3600;

  const weights = Object.entries(state.weights ?? {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const alloc = state.allocator;
  const trades = state.trades_today ?? [];

  return (
    <>
      <div className="flex items-center gap-2 mb-2 text-[12px]">
        <span className={`inline-flex items-center gap-1 ${stale ? "text-amber" : "text-green"}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${stale ? "bg-amber" : "bg-green animate-pulse"}`} />
          {stale ? "STALE" : "PAPER ACTIVE"}
        </span>
        <span className="text-dim">{updatedAt ? `updated ${secsAgo}s ago` : "polling every 20s"}</span>
      </div>

      <div className="border border-amber/40 bg-amber/5 p-3 mb-3">
        <div className="text-[32px] font-bold tabular-nums text-amber leading-none">{usd(state.equity)}</div>
        <div className="text-[12px] text-dim mt-1">
          {state.cycle_utc ? `last cycle ${state.cycle_utc.slice(0, 16).replace("T", " ")} UTC` : "not yet run"}
          {" · "}same TSMOM signal + Allocator as MCScalp (crypto), applied to a fixed 10-stock equity universe.
        </div>
      </div>

      {alloc && (
        <div className="border border-border bg-grid p-3 mb-3">
          <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">LEVERAGE STACK</div>
          <table className="w-full text-[13px]">
            <tbody>
              {[
                ["Kelly leverage", `${alloc.kelly_leverage.toFixed(2)}×`],
                ["Vol scale", `${alloc.vol_scale.toFixed(2)}×`],
                ["DD de-lever", `${(alloc.drawdown_scale * 100).toFixed(0)}%`],
                ["Corr brake", `${(alloc.corr_brake * 100).toFixed(0)}%`],
                ["Net gross", `${alloc.leverage_scale.toFixed(2)}×`],
              ].map(([k, v]) => (
                <tr key={k} className="dotted-row">
                  <td className="py-0.5 text-dim">{k}</td>
                  <td className={`py-0.5 text-right tabular-nums font-bold ${k === "Net gross" ? "text-amber" : "text-muted"}`}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border border-border bg-grid p-3 mb-3">
        <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">WEIGHTS · {state.universe.length} SYMBOLS</div>
        {weights.length > 0 ? (
          <table className="w-full text-[13px]">
            <tbody>
              {weights.map(([symbol, w]) => (
                <tr key={symbol} className="dotted-row">
                  <td className="py-1 text-white font-bold">{symbol}</td>
                  <td className="py-1 text-right tabular-nums text-dim">{usd(state.positions_usd?.[symbol], 0)}</td>
                  <td className={`py-1 text-right tabular-nums font-bold ${w >= 0 ? "text-green" : "text-red"}`}>
                    {w >= 0 ? "L" : "S"} {(Math.abs(w) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-dim text-[12px] italic py-2">All symbols FLAT — no signal above threshold. Capital in cash.</div>
        )}
      </div>

      <div className="border border-border bg-grid p-3">
        <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">TRADES TODAY</div>
        {trades.length > 0 ? (
          <table className="w-full text-[12px]">
            <tbody>
              {trades.map((t, i) => (
                <tr key={`${t.symbol}-${i}`} className="dotted-row">
                  <td className="py-1 text-white font-bold">{t.symbol}</td>
                  <td className={`py-1 uppercase font-bold ${t.side === "sell" ? "text-red" : "text-green"}`}>{t.side}</td>
                  <td className="py-1 text-right tabular-nums text-dim">{usd(t.usd, 0)}</td>
                  <td className="py-1 text-right tabular-nums text-dim">{t.ts.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-dim text-[12px] italic py-2">No rebalance crossed threshold today — positions held steady.</div>
        )}
      </div>
    </>
  );
}
