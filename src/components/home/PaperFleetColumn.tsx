"use client";

import Link from "next/link";
import type { BotStatus } from "@/lib/ai-portfolio/overview";
import { healthColor, pct, rel, signedUsd, usd } from "@/components/ai-portfolio/format";

/** Paper/forward-test fleet — one compact row per bot. */
export function PaperFleetColumn({ bots }: { bots: BotStatus[] }) {
  return (
    <div>
      <div className="text-cyan text-[11px] uppercase tracking-[2px] mb-2">□ Paper fleet</div>
      <div className="border border-border bg-grid">
        {bots.map((bot) => {
          const off = bot.health === "off";
          return (
            <Link
              key={bot.key}
              href={bot.href}
              className="flex items-center gap-2 px-3 py-2 dotted-row hover:bg-cyan/5 transition-colors"
            >
              <span className={`${healthColor[bot.health]} text-[10px]`}>●</span>
              <span className="text-[11px] tracking-[0.5px] flex-1 min-w-0 truncate">
                {bot.label}
                {!off && bot.openPositions != null && bot.openPositions > 0 && (
                  <span className="text-amber ml-1">·{bot.openPositions}</span>
                )}
              </span>
              {off ? (
                <span className="text-dim text-[10px] uppercase tracking-[1px] text-right">
                  OFF · BENCHED
                </span>
              ) : (
                <>
                  <span className="tabular-nums text-[11px] text-right">
                    {usd(bot.equityOrValue)}
                    <span className={`ml-2 ${bot.pnl == null ? "text-dim" : bot.pnl >= 0 ? "text-green" : "text-red"}`}>
                      {bot.pnl != null && bot.pnl !== 0 ? signedUsd(bot.pnl) : "$0"}
                      {bot.pnlPct != null && bot.pnlPct !== 0 ? ` ${pct(bot.pnlPct, 2)}` : ""}
                    </span>
                  </span>
                  <span className="text-dim text-[10px] tabular-nums w-8 text-right">{rel(bot.lastActivity)}</span>
                </>
              )}
            </Link>
          );
        })}
      </div>
      <div className="text-dim text-[10px] mt-1">● health · amber count = open positions · right = last activity</div>
    </div>
  );
}
