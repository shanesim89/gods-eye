"use client";
import type { VulcanDashboardData } from "@/lib/trading/vulcan-dashboard";

function usd(v: number, dec = 2): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

export function VulcanLive({ data }: { data: VulcanDashboardData }) {
  const pnlPct = data.totalValue > 0 ? (data.totalPnl / (data.totalValue - data.totalPnl)) * 100 : null;
  const topCandidates = data.candidates.slice(0, 40);

  return (
    <>
      {/* Hero */}
      <div className="border border-amber/40 bg-amber/5 p-3 mb-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <span className="text-[12px] tracking-[1.5px] text-amber font-bold">◆ PAPER FORWARD</span>
          <span className="text-[12px] text-dim">
            {data.latestRunDate ? `last run ${data.latestRunDate}` : "not yet run"}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
          <div>
            <div className="text-[32px] font-bold tabular-nums text-amber leading-none">{usd(data.totalValue)}</div>
            <div className={`text-[13px] mt-1 ${data.totalPnl >= 0 ? "text-green" : "text-red"}`}>
              {data.totalPnl >= 0 ? "+" : ""}
              {usd(data.totalPnl)}
              {pnlPct != null && ` (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)`} paper
            </div>
          </div>
          <div className="text-[12px] text-muted leading-relaxed max-w-md">
            Weekly sector-momentum + RS/volume/stage rotation — top {data.holdings.length || 20} equities, equal-weight
            $250 positions.
          </div>
        </div>
      </div>

      {/* Holdings */}
      <div className="border border-border bg-grid p-3 mb-3">
        <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">OPEN POSITIONS</div>
        {data.holdings.length > 0 ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-dim text-[12px] uppercase tracking-[1px]">
                <td className="py-1">Symbol</td>
                <td className="py-1 text-right">Qty</td>
                <td className="py-1 text-right">Entry</td>
                <td className="py-1 text-right">Current</td>
                <td className="py-1 text-right">P/L</td>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h) => (
                <tr key={h.symbol} className="dotted-row">
                  <td className="py-1 text-white font-bold">{h.symbol}</td>
                  <td className="py-1 text-right tabular-nums text-muted">{h.qty.toFixed(2)}</td>
                  <td className="py-1 text-right tabular-nums text-dim">{usd(h.entryPrice)}</td>
                  <td className="py-1 text-right tabular-nums text-dim">
                    {h.currentPrice != null ? usd(h.currentPrice) : "—"}
                  </td>
                  <td className={`py-1 text-right tabular-nums font-bold ${
                    (h.pnl ?? 0) >= 0 ? "text-green" : "text-red"
                  }`}>
                    {h.pnl != null ? `${h.pnl >= 0 ? "+" : ""}${usd(h.pnl)}` : "—"}
                    {h.pnlPct != null && (
                      <span className="text-[11px] font-normal text-dim"> ({h.pnlPct >= 0 ? "+" : ""}{h.pnlPct.toFixed(1)}%)</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-dim text-[12px] italic py-2">No open positions — runs weekly (Mondays UTC).</div>
        )}
      </div>

      {/* Ranked candidates */}
      <div className="border border-border bg-grid p-3 mb-3">
        <div className="text-muted text-[12px] mb-2 uppercase tracking-[1px]">
          RANKED CANDIDATES {data.latestRunDate ? `— ${data.latestRunDate}` : ""}
        </div>
        {topCandidates.length > 0 ? (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-dim text-[12px] uppercase tracking-[1px]">
                <td className="py-1">Rank</td>
                <td className="py-1">Symbol</td>
                <td className="py-1">Sector</td>
                <td className="py-1 text-right">Score</td>
                <td className="py-1 text-right">Stage-2</td>
                <td className="py-1 text-right">Held</td>
              </tr>
            </thead>
            <tbody>
              {topCandidates.map((c) => (
                <tr key={c.symbol} className="dotted-row">
                  <td className="py-1 text-dim tabular-nums">{c.compositeRank ?? "—"}</td>
                  <td className="py-1 text-white font-bold">{c.symbol}</td>
                  <td className="py-1 text-muted">{c.sector}</td>
                  <td className="py-1 text-right tabular-nums text-amber">{c.compositeScore.toFixed(1)}</td>
                  <td className={`py-1 text-right ${c.stage2Eligible ? "text-green" : "text-dim"}`}>
                    {c.stage2Eligible ? "✓" : "—"}
                  </td>
                  <td className={`py-1 text-right ${c.held ? "text-cyan" : "text-dim"}`}>{c.held ? "●" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-dim text-[12px] italic py-2">No scored run yet — first run publishes Monday 13:00 UTC.</div>
        )}
      </div>

      {/* How it works */}
      <div className="border border-border/40 bg-grid p-3 text-[12px] text-dim leading-relaxed">
        <span className="text-muted">◎ HOW IT WORKS</span> — Weekly: rank the 11 GICS sectors by
        blended 1mo/3mo equal-weight momentum, take the top 4 sectors' constituents (~150-200
        names). Score each on relative-strength percentile (6mo return) and up/down volume
        percentile (50-session), gated by a binary Stage-2 filter (price above a rising 30-week
        SMA). Top 20 by composite score, equal-weight $250 positions via Alpaca paper, rotated
        out on rank drop. No stop-loss — pure rank-rotation. Not financial advice.
      </div>
    </>
  );
}
