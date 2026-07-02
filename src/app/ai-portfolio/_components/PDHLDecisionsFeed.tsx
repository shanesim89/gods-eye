import type { PDHLOpenPos, PDHLTradeRow } from "./types";

function usd(v: number, dec = 2): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

// Turn raw gate-skip keys into plain English so idle time reads as decisions, not blanks.
function skipLabel(key: string): string {
  if (key.startsWith("risk")) return "risk block";
  switch (key) {
    case "warmup": return "warming up";
    case "session": return "outside session";
    case "no_pdhl": return "no PDH/PDL yet";
    case "period_flat": return "period range too flat";
    case "break_fail": return "break failed — reversed through level";
    case "retest_timeout": return "retest window expired";
    case "retest_long": return "retest confirmed — long queued";
    case "retest_short": return "retest confirmed — short queued";
    default: return key;
  }
}

/** "What the bot decided, and why" — directive + why-it's-idle + closed trades. */
export function PDHLDecisionsFeed({
  openPosition,
  recentTrades,
  skips,
}: {
  openPosition?: PDHLOpenPos | null;
  recentTrades: PDHLTradeRow[];
  skips?: Record<string, number>;
}) {
  const pos = openPosition;
  const skipRows = Object.entries(skips ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="border border-border bg-grid p-3 mb-3">
      <div className="text-muted text-[14px] mb-2 uppercase tracking-[1px]">DECISIONS</div>

      {/* current directive */}
      <div className="mb-3">
        {pos ? (
          <div className={`text-[16px] font-bold ${pos.direction > 0 ? "text-green" : "text-red"}`}>
            ▶ OPEN {pos.direction > 0 ? "LONG (break above PDH)" : "SHORT (break below PDL)"} @ {usd(pos.entry)}
            <span className="text-dim font-normal">
              {" "}
              · level {usd(pos.level)} ·{" "}
              {pos.tp1_done
                ? `TP1 banked, runner ${(pos.remaining ?? pos.size).toFixed(4)} oz @ breakeven`
                : `full size ${pos.size.toFixed(4)} oz`}
            </span>
          </div>
        ) : (
          <div className="text-[16px] font-bold text-dim">
            ▪ FLAT <span className="font-normal">— scanning for a confirmed PDH/PDL break+retest</span>
          </div>
        )}
      </div>

      {/* why it's mostly idle — gate rejection tally */}
      {skipRows.length > 0 && (
        <div className="mb-3">
          <div className="text-dim text-[14px] mb-1 uppercase tracking-[1px]">WHY IT SKIPPED (lifetime)</div>
          <div className="flex flex-wrap gap-1.5">
            {skipRows.map(([k, n]) => (
              <span key={k} className="border border-border px-1.5 py-0.5 text-[14px] text-dim tabular-nums">
                {skipLabel(k)} <span className="text-muted">×{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* closed trades */}
      <div className="text-dim text-[14px] mb-1 uppercase tracking-[1px]">CLOSED TRADES · LAST 24H</div>
      {recentTrades.length > 0 ? (
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-dim text-[14px] uppercase tracking-[1px]">
              <td className="py-1">Time (UTC)</td>
              <td className="py-1">Side</td>
              <td className="py-1 text-right">Entry</td>
              <td className="py-1 text-right">Exit</td>
              <td className="py-1 text-right">Level</td>
              <td className="py-1 text-right">Why</td>
              <td className="py-1 text-right">PnL</td>
            </tr>
          </thead>
          <tbody>
            {recentTrades.map((t, i) => (
              <tr key={`${t.exit}-${i}`} className="dotted-row">
                <td className="py-1 text-dim tabular-nums whitespace-nowrap">
                  {t.exit.slice(5, 16).replace("T", " ")}
                </td>
                <td className={`py-1 font-bold ${t.side === "LONG" ? "text-green" : "text-red"}`}>{t.side}</td>
                <td className="py-1 text-right tabular-nums text-muted">{usd(t.entry)}</td>
                <td className="py-1 text-right tabular-nums text-muted">{usd(t.exit_px)}</td>
                <td className="py-1 text-right tabular-nums text-cyan">{usd(t.level)}</td>
                <td className="py-1 text-right text-dim">{t.reason ?? "—"}</td>
                <td className={`py-1 text-right tabular-nums font-bold ${t.pnl >= 0 ? "text-green" : "text-red"}`}>
                  {t.pnl >= 0 ? "+" : ""}{usd(t.pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-dim text-[14px] italic py-2">
          No closed trades in the last 24h. {pos ? "A break+retest trade is open now." : "Waiting for a PDH/PDL break+retest."}
        </div>
      )}
    </div>
  );
}
