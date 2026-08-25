"use client";

import type { DailyCell } from "@/lib/ai-portfolio/overview";

// Background bucket for a day cell, by net P/L dollars. Mirrors CryptoHeatmap's
// stepped green/red scale but keyed on signed $ (scalper P/L is small-dollar).
function cellBg(net: number): string {
  if (net <= -100) return "#450a0a";
  if (net <= -25) return "#7f1d1d";
  if (net < 0) return "#991b1b";
  if (net === 0) return "#14202e";
  if (net < 25) return "#14532d";
  if (net < 100) return "#166534";
  return "#15803d";
}
function fg(v: number): string {
  return v > 0 ? "#86efac" : v < 0 ? "#fca5a5" : "#6b7f8f";
}

// Short 3-char tickers for the cramped per-bot lines inside each day box.
const ABBR: Record<string, string> = {
  gold: "GLD", pdhl: "PDH", pdhl4h: "P4H", pdhl8h: "P8H",
  quant: "QNT", options: "OPT", crypto: "CRY",
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function dow(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}
function dayNum(day: string): string {
  return String(new Date(`${day}T00:00:00Z`).getUTCDate());
}
function fullDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}
function fmt(v: number): string {
  const abs = Math.abs(v);
  const n = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : Math.round(abs).toString();
  return v > 0 ? `+${n}` : v < 0 ? `-${n}` : "0";
}

export function ProfitCalendar({ daily }: { daily: DailyCell[] }) {
  if (daily.length === 0) {
    return <div className="text-dim text-[11px] italic">No calendar data yet.</div>;
  }

  const leadPad = dow(daily[0].day); // blank cells before the first day

  return (
    <div>
      {/* legend */}
      <div className="flex items-center gap-4 mb-2 text-[11px] text-dim uppercase tracking-[0.5px]">
        <span className="flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5" style={{ background: "#15803d" }} /> profit</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5" style={{ background: "#991b1b" }} /> loss</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 border border-dashed border-border/60 bg-grid" /> no activity</span>
      </div>

      {/* weekday header */}
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-center text-[10px] text-dim uppercase tracking-[1px]">{w}</div>
        ))}
      </div>

      {/* day grid — every cell lists every bot's daily P/L, $0 included */}
      <div className="grid grid-cols-7 gap-1.5 overflow-x-auto">
        {Array.from({ length: leadPad }).map((_, i) => <div key={`pad-${i}`} />)}
        {daily.map((d) => {
          const bg = d.active ? cellBg(d.netPnl) : "#14202e";
          return (
            <div
              key={d.day}
              title={fullDate(d.day)}
              className={`min-w-[92px] p-2 border ${d.active ? "border-black/30" : "border-dashed border-border/50"}`}
              style={{
                background: bg,
                backgroundImage: d.active
                  ? undefined
                  : "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(120,140,160,0.14) 4px, rgba(120,140,160,0.14) 5px)",
              }}
            >
              <div className="flex justify-between items-baseline leading-none mb-1.5 pb-1 border-b border-white/10">
                <span className="text-[12px] text-white/70 tabular-nums font-medium">{dayNum(d.day)}</span>
                <span className="text-[13px] font-bold tabular-nums" style={{ color: fg(d.netPnl) }}>
                  {fmt(d.netPnl)}
                </span>
              </div>
              <div className="flex flex-col gap-[3px]">
                {d.bots.map((b) => {
                  const v = b.pnl ?? 0;
                  return (
                    <div key={b.bot} className="flex justify-between leading-none text-[11px] tabular-nums">
                      <span className="text-white/55 tracking-wide">{ABBR[b.bot]}</span>
                      <span className="font-medium" style={{ color: fg(v) }}>{fmt(v)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
