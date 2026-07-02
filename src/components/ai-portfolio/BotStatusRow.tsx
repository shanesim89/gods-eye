import Link from "next/link";
import type { BotStatus } from "@/lib/ai-portfolio/overview";
import { usd, signedUsd, pct, rel, healthColor, healthDot } from "./format";

export function BotStatusRow({ bot }: { bot: BotStatus }) {
  return (
    <Link
      href={bot.href}
      className="grid grid-cols-[14px_1.4fr_1fr_1fr_1fr_auto] items-center gap-2 px-2.5 py-2 border border-border bg-grid hover:border-amber/60 transition-colors text-[11px]"
    >
      <span
        className={`w-2 h-2 rounded-full ${healthDot[bot.health] ?? "bg-dim"} ${bot.health === "stale" || bot.health === "halt" ? "live-blip" : ""}`}
        title={bot.healthNote ?? bot.health}
      />
      <div className="min-w-0">
        <div className="text-cyan font-bold tracking-[0.5px] truncate">▸ {bot.label}</div>
        <div className="text-dim text-[10px] truncate">{bot.asset}</div>
      </div>
      <div>
        <span
          className={`text-[8px] uppercase tracking-[1px] px-1.5 py-0.5 border ${
            bot.mode === "LIVE" ? "border-green/50 text-green" : "border-amber/40 text-amber"
          }`}
        >
          {bot.mode}
        </span>
      </div>
      <div className="text-right tabular-nums">
        <div className="text-muted">{usd(bot.equityOrValue)}</div>
        <div className="text-dim text-[10px] uppercase tracking-[1px]">{bot.valueLabel}</div>
      </div>
      <div className="text-right tabular-nums">
        <div className={(bot.pnl ?? 0) >= 0 ? "text-green" : "text-red"}>{signedUsd(bot.pnl)}</div>
        <div className="text-dim text-[10px]">{bot.pnlPct != null ? pct(bot.pnlPct) : ""}</div>
      </div>
      <div className="text-right pl-2">
        <div className={`text-[9px] uppercase tracking-[1px] ${healthColor[bot.health] ?? "text-dim"}`}>
          {bot.health}
        </div>
        <div className="text-dim text-[10px] tabular-nums">{rel(bot.lastActivity)} ago</div>
      </div>
    </Link>
  );
}
