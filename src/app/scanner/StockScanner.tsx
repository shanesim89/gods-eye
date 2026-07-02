"use client";
import { useState } from "react";
import type { DipResult } from "@/lib/stocks/dip-bounce";
import type { LeaderResult } from "@/lib/stocks/leaders";
import { DipBounceTable } from "./DipBounceTable";
import { LeadersTable } from "./LeadersTable";

type Mode = "dip" | "leaders";

export function StockScanner({ dip, leaders }: { dip: DipResult | null; leaders: LeaderResult | null }) {
  const [mode, setMode] = useState<Mode>("dip");

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setMode("dip")}
          className={`px-3 py-1 text-[10px] uppercase tracking-[1px] border ${
            mode === "dip" ? "border-amber text-amber bg-amber/10" : "border-border text-dim hover:text-muted"
          }`}
        >
          ↓ DIP-BOUNCE
        </button>
        <button
          onClick={() => setMode("leaders")}
          className={`px-3 py-1 text-[10px] uppercase tracking-[1px] border ${
            mode === "leaders" ? "border-amber text-amber bg-amber/10" : "border-border text-dim hover:text-muted"
          }`}
        >
          ↑ LEADERS
        </button>
      </div>

      {mode === "dip" ? <DipBounceTable initial={dip} /> : <LeadersTable initial={leaders} />}

      <div className="border border-border/40 bg-grid p-3 mt-3 text-[10px] text-dim leading-relaxed">
        {mode === "dip" ? (
          <>
            <span className="text-muted">◎ DIP-BOUNCE</span> — mean reversion. Ranks oversold
            stocks by <span className="text-muted">bounce probability</span> if the market
            recovers (RSI oversold + turning, drop depth, stretch below MA20, volume
            contraction, support proximity). ✓ DEEP·BOUNCE = deep drawdown + strong setup.
            Buys weakness.
          </>
        ) : (
          <>
            <span className="text-muted">◎ LEADERS</span> — momentum + growth. Ranks stocks
            already in strong uptrends (12-1 momentum, near 52wk high, outperforming SPY,
            Stage-2 MA stack) with accelerating revenue/EPS.{" "}
            <span className="text-green">EARLY</span> = not extended, better entry;{" "}
            <span className="text-amber">EXTENDED</span> = strong but stretched, chase risk.
            Buys strength — catches NVDA/AMD-type runs early, not at the bottom. Not advice — DYOR.
          </>
        )}
      </div>
    </div>
  );
}
