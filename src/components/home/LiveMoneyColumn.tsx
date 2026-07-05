"use client";

import Link from "next/link";
import type { BotStatus } from "@/lib/ai-portfolio/overview";
import { pct, rel, signedUsd, usd } from "@/components/ai-portfolio/format";

/** Real-money bots — dominant left column. Green border marks live capital. */
export function LiveMoneyColumn({ bots }: { bots: BotStatus[] }) {
  return (
    <div>
      <div className="text-green text-[11px] uppercase tracking-[2px] mb-2">
        ■ Live money — {usd(bots.reduce((s, b) => s + b.equityOrValue, 0))}
      </div>
      {bots.map((bot) => (
        <div key={bot.key} className="mb-2">
          <Link href={bot.href} className="block border border-green/50 bg-grid p-3 hover:border-green transition-colors">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-bold tracking-[1px]">{bot.label}</span>
              <span className="tabular-nums text-[13px]">
                {usd(bot.equityOrValue, 2)}{" "}
                <span className={bot.pnl == null ? "text-dim" : bot.pnl >= 0 ? "text-green" : "text-red"}>
                  {signedUsd(bot.pnl, 2)} {bot.pnlPct != null ? `(${pct(bot.pnlPct)})` : ""}
                </span>
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {bot.holdings.map((h) => (
                <div key={h.label} className="flex justify-between text-[11px] dotted-row py-0.5">
                  <span className="text-muted">{h.label} <span className="text-dim">{h.detail}</span></span>
                  <span className="tabular-nums">
                    {h.value != null ? usd(h.value, 2) : ""}
                    {h.pnl != null && (
                      <span className={h.pnl >= 0 ? "text-green ml-2" : "text-red ml-2"}>{signedUsd(h.pnl, 2)}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="text-dim text-[10px] mt-2">
              last activity {rel(bot.lastActivity)} ago{bot.healthNote ? ` · ${bot.healthNote}` : ""}
            </div>
          </Link>
          {bot.alert && (
            <div className="border border-red/70 bg-red/5 text-red px-3 py-2 mt-2 text-[11px] leading-relaxed">
              ⚠ {bot.alert}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
