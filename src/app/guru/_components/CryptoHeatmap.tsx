"use client";
import Link from "next/link";
import type { CryptoTile } from "@/lib/market-overview";

function pctBg(pct: number): string {
  if (pct <= -10)  return "#450a0a";
  if (pct <= -5)   return "#7f1d1d";
  if (pct <= -1)   return "#991b1b";
  if (pct < 1)     return "#1a1f2e";
  if (pct < 5)     return "#14532d";
  if (pct < 10)    return "#166534";
  return "#15803d";
}

function pctFg(pct: number): string {
  if (pct <= -1)  return "#fca5a5";
  if (pct < 1)    return "#6b7280";
  return "#86efac";
}

function fmtPrice(p: number): string {
  if (p >= 1000)  return `$${(p / 1000).toFixed(1)}k`;
  if (p >= 1)     return `$${p.toFixed(2)}`;
  return `$${p.toPrecision(3)}`;
}

export function CryptoHeatmap({ data }: { data: CryptoTile[] }) {
  if (data.length === 0)
    return <div className="text-dim text-[10px] italic">no data</div>;

  const maxCap = Math.max(...data.map((d) => d.mktCap));

  // Sort: BTC first, then by mktcap descending (already ordered from API, just in case)
  const sorted = [...data].sort((a, b) => b.mktCap - a.mktCap);

  const gainers = sorted.filter((t) => t.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 3);
  const losers  = sorted.filter((t) => t.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 3);

  return (
    <div>
      {/* Quick stats */}
      <div className="flex gap-4 mb-3 text-[10px]">
        <span className="text-muted">
          TOP GAINERS:{" "}
          {gainers.map((t) => (
            <span key={t.symbol} className="text-green mr-1">
              {t.symbol} +{t.pct.toFixed(1)}%
            </span>
          ))}
        </span>
        <span className="text-muted">
          TOP LOSERS:{" "}
          {losers.map((t) => (
            <span key={t.symbol} className="text-red mr-1">
              {t.symbol} {t.pct.toFixed(1)}%
            </span>
          ))}
        </span>
      </div>

      {/* Tiles: size proportional to sqrt(mktCap) */}
      <div className="flex flex-wrap gap-0.5">
        {sorted.map((t) => {
          const ratio = Math.sqrt(t.mktCap / maxCap);
          // Range: min 44px (small coins) to 110px (BTC)
          const size = Math.max(44, Math.round(ratio * 110));
          return (
            <Link
              key={t.id}
              href={`/guru/crypto/${t.symbol}`}
              style={{
                background: pctBg(t.pct),
                width: size,
                height: size,
              }}
              className="p-1.5 flex flex-col justify-between hover:opacity-75 transition-opacity border border-black/30 shrink-0 overflow-hidden"
              title={`${t.name} | ${t.pct >= 0 ? "+" : ""}${t.pct.toFixed(2)}% | ${fmtPrice(t.price)}`}
            >
              <div className="text-[9px] font-bold text-white/90 leading-none truncate">{t.symbol}</div>
              {size >= 60 && (
                <div className="text-[8px] text-white/50 leading-none truncate">{fmtPrice(t.price)}</div>
              )}
              <div className="text-[9px] leading-none" style={{ color: pctFg(t.pct) }}>
                {t.pct >= 0 ? "+" : ""}{t.pct.toFixed(2)}%
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
