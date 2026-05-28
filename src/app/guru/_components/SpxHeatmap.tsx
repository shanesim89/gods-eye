"use client";
import Link from "next/link";
import type { SpxTile } from "@/lib/market-overview";

function pctBg(pct: number): string {
  if (pct <= -5)   return "#450a0a";
  if (pct <= -2)   return "#7f1d1d";
  if (pct <= -0.5) return "#991b1b";
  if (pct < 0.5)   return "#1a1f2e";
  if (pct < 2)     return "#14532d";
  if (pct < 5)     return "#166534";
  return "#15803d";
}

function pctFg(pct: number): string {
  if (pct <= -0.5) return "#fca5a5";
  if (pct < 0.5)   return "#6b7280";
  return "#86efac";
}

export function SpxHeatmap({ data }: { data: SpxTile[] }) {
  if (data.length === 0)
    return <div className="text-dim text-[10px] italic">no data</div>;

  // Group by sector, preserve insertion order
  const sectorMap = new Map<string, SpxTile[]>();
  for (const t of data) {
    if (!sectorMap.has(t.sector)) sectorMap.set(t.sector, []);
    sectorMap.get(t.sector)!.push(t);
  }

  // Legend
  const legend: [string, string][] = [
    ["< −5%", "#450a0a"],
    ["−2–5%", "#7f1d1d"],
    ["−0.5–2%", "#991b1b"],
    ["flat", "#1a1f2e"],
    ["0.5–2%", "#14532d"],
    ["2–5%", "#166534"],
    ["> 5%", "#15803d"],
  ];

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-3">
        {legend.map(([lbl, col]) => (
          <span key={lbl} className="flex items-center gap-1 text-[9px] text-dim">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: col }} />
            {lbl}
          </span>
        ))}
      </div>

      {/* Sectors */}
      {Array.from(sectorMap.entries()).map(([sector, tiles]) => (
        <div key={sector} className="mb-3">
          <div className="text-[9px] text-muted uppercase tracking-[1px] mb-1">
            {sector}
            <span className="ml-2 text-dim">
              avg {(() => {
                const avg = tiles.reduce((s, t) => s + t.pct, 0) / tiles.length;
                return <span style={{ color: avg >= 0 ? "#86efac" : "#fca5a5" }}>
                  {avg >= 0 ? "+" : ""}{avg.toFixed(2)}%
                </span>;
              })()}
            </span>
          </div>
          <div className="flex flex-wrap gap-0.5">
            {tiles.map((t) => (
              <Link
                key={t.ticker}
                href={`/guru/stocks/${t.ticker}`}
                style={{ background: pctBg(t.pct) }}
                className="w-[72px] h-[44px] p-1.5 flex flex-col justify-between hover:opacity-75 transition-opacity border border-black/30 shrink-0"
                title={`${t.name} | ${t.pct >= 0 ? "+" : ""}${t.pct.toFixed(2)}% | $${t.price.toFixed(2)}`}
              >
                <div className="text-[9px] font-bold text-white/90 leading-none">{t.ticker}</div>
                <div className="text-[9px] leading-none" style={{ color: pctFg(t.pct) }}>
                  {t.pct >= 0 ? "+" : ""}{t.pct.toFixed(2)}%
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
