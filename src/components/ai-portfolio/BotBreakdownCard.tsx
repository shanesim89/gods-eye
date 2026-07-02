import Link from "next/link";
import type { BotStatus } from "@/lib/ai-portfolio/overview";
import { usd, signedUsd, pct, healthColor } from "./format";
import { ActivityTable } from "./ActivityTable";

export function BotBreakdownCard({ bot }: { bot: BotStatus }) {
  return (
    <div className="border border-border bg-grid p-3 flex flex-col">
      {/* header */}
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0">
          <Link href={bot.href} className="text-cyan font-bold tracking-[0.5px] text-[12px] hover:underline">
            ▸ {bot.label}
          </Link>
          <div className="text-dim text-[10px] mt-0.5">
            {bot.asset} ·{" "}
            <span className={bot.mode === "LIVE" ? "text-green" : "text-amber"}>{bot.mode}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-muted tabular-nums text-[14px] font-bold leading-none">
            {usd(bot.equityOrValue)}
          </div>
          <div className="text-dim text-[10px] uppercase tracking-[1px] mt-0.5">{bot.valueLabel}</div>
        </div>
      </div>

      {/* P/L + health */}
      <div className="flex items-center justify-between mb-2 text-[10px]">
        <div className="tabular-nums">
          <span className="text-dim uppercase tracking-[1px] mr-1.5">P/L</span>
          <span className={(bot.pnl ?? 0) >= 0 ? "text-green" : "text-red"}>
            {signedUsd(bot.pnl)}
            {bot.pnlPct != null && ` (${pct(bot.pnlPct)})`}
          </span>
        </div>
        <div className={`uppercase tracking-[1px] text-[9px] ${healthColor[bot.health] ?? "text-dim"}`}>
          {bot.health}
          {bot.healthNote ? ` · ${bot.healthNote}` : ""}
        </div>
      </div>

      {/* holdings */}
      <div className="text-dim text-[10px] uppercase tracking-[1px] mb-1">Holdings</div>
      {bot.holdings.length > 0 ? (
        <table className="w-full text-[10px] mb-2">
          <tbody>
            {bot.holdings.map((h, i) => (
              <tr key={`${h.label}-${i}`} className="dotted-row">
                <td className="py-1 text-muted font-bold whitespace-nowrap pr-2">{h.label}</td>
                <td className="py-1 text-dim">{h.detail}</td>
                <td className="py-1 text-right tabular-nums whitespace-nowrap">
                  {h.value != null && <span className="text-muted">{usd(h.value)}</span>}
                  {h.pnl != null && (
                    <span className={`ml-1.5 ${h.pnl >= 0 ? "text-green" : "text-red"}`}>{signedUsd(h.pnl)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-dim text-[10px] italic py-1 mb-2">No open holdings.</div>
      )}

      {/* last 24h activity */}
      <div className="text-dim text-[10px] uppercase tracking-[1px] mb-1 mt-1">Last 24h · trades / decisions</div>
      <ActivityTable rows={bot.recent} fallbackNote={bot.fallbackNote} />
    </div>
  );
}
