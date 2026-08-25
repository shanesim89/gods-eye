"use client";

import type { HomeState } from "@/lib/ai-portfolio/overview";
import { signedUsd, usd } from "@/components/ai-portfolio/format";

/** Top metric tiles: total book, paper P/L, fleet health, alert chip. */
export function HeroStrip({ hero, alerts, liveValue }: {
  hero: HomeState["hero"];
  alerts: string[];
  liveValue: number;
}) {
  const issues = hero.warn + hero.halt + hero.stale;
  const tile = "flex-1 min-w-[140px] border border-border bg-grid px-3 py-2";
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <div className={tile}>
        <div className="text-dim text-[10px] uppercase tracking-[1.5px]">Total book</div>
        <div className="text-[18px] tabular-nums">{usd(hero.totalBook)}</div>
        <div className="text-dim text-[10px] tabular-nums">live {usd(liveValue)} · paper {usd(hero.totalBook - liveValue)}</div>
      </div>
      <div className={tile}>
        <div className="text-dim text-[10px] uppercase tracking-[1.5px]">Paper P/L (all-time)</div>
        <div className={`text-[18px] tabular-nums ${hero.todayPnl >= 0 ? "text-green" : "text-red"}`}>
          {signedUsd(hero.todayPnl, 2)}
        </div>
      </div>
      <div className={tile}>
        <div className="text-dim text-[10px] uppercase tracking-[1.5px]">Fleet health</div>
        <div className="text-[18px] tabular-nums">
          <span className="text-green">{hero.ok} OK</span>
          {hero.off > 0 && <span className="text-dim"> · {hero.off} OFF</span>}
          {issues > 0 && (
            <span className="text-amber"> · {issues} {hero.halt > 0 ? "HALT" : hero.stale > 0 ? "STALE" : "WARN"}</span>
          )}
        </div>
      </div>
      {alerts.length > 0 && (
        <div className="flex-1 min-w-[180px] border border-amber/70 bg-amber/5 px-3 py-2">
          <div className="text-amber text-[10px] uppercase tracking-[1.5px]">⚠ Attention</div>
          <div className="text-amber text-[11px] leading-relaxed">{alerts[0]}{alerts.length > 1 ? ` (+${alerts.length - 1} more)` : ""}</div>
        </div>
      )}
    </div>
  );
}
