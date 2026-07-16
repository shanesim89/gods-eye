"use client";

import { useMemo, useState } from "react";
import type { DailyCell } from "@/lib/ai-portfolio/overview";
import { signedUsd, pct } from "@/components/ai-portfolio/format";

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
function cellFg(net: number): string {
  if (net < 0) return "#fca5a5";
  if (net === 0) return "#8aa0b0";
  return "#86efac";
}

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

export function ProfitCalendar({ daily }: { daily: DailyCell[] }) {
  const lastActive = useMemo(
    () => [...daily].reverse().find((d) => d.active)?.day ?? daily.at(-1)?.day ?? null,
    [daily],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const selDay = selected ?? lastActive;
  const sel = daily.find((d) => d.day === selDay) ?? null;

  if (daily.length === 0) {
    return <div className="text-dim text-[11px] italic">No calendar data yet.</div>;
  }

  const leadPad = dow(daily[0].day); // blank cells before the first day

  return (
    <div>
      {/* legend */}
      <div className="flex items-center gap-3 mb-2 text-[9px] text-dim uppercase tracking-[0.5px]">
        <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5" style={{ background: "#15803d" }} /> profit</span>
        <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5" style={{ background: "#991b1b" }} /> loss</span>
        <span className="flex items-center gap-1">
          <i className="inline-block w-2.5 h-2.5 border border-dashed border-border/60" style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(120,140,160,0.18) 2px, rgba(120,140,160,0.18) 3px)" }} />
          no activity
        </span>
      </div>

      {/* weekday header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-center text-[8px] text-dim uppercase tracking-[1px]">{w}</div>
        ))}
      </div>

      {/* day grid */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leadPad }).map((_, i) => <div key={`pad-${i}`} />)}
        {daily.map((d) => {
          const isSel = d.day === selDay;
          const ring = isSel ? "outline outline-1 outline-cyan" : "";
          if (!d.active) {
            return (
              <button
                key={d.day}
                onClick={() => setSelected(d.day)}
                title={`${fullDate(d.day)} · no activity`}
                className={`aspect-square flex items-start justify-end p-1 border border-dashed border-border/50 ${ring}`}
                style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(120,140,160,0.12) 3px, rgba(120,140,160,0.12) 4px)" }}
              >
                <span className="text-[9px] text-dim tabular-nums leading-none">{dayNum(d.day)}</span>
              </button>
            );
          }
          return (
            <button
              key={d.day}
              onClick={() => setSelected(d.day)}
              title={`${fullDate(d.day)} · ${signedUsd(d.netPnl)}`}
              className={`aspect-square flex flex-col justify-between p-1 border border-black/30 hover:opacity-80 transition-opacity ${ring}`}
              style={{ background: cellBg(d.netPnl) }}
            >
              <span className="text-[9px] text-white/70 tabular-nums leading-none self-end">{dayNum(d.day)}</span>
              <span className="text-[9px] font-bold tabular-nums leading-none" style={{ color: cellFg(d.netPnl) }}>
                {d.netPnl >= 0 ? "+" : "−"}{Math.abs(d.netPnl) >= 1000 ? `${(Math.abs(d.netPnl) / 1000).toFixed(1)}k` : Math.round(Math.abs(d.netPnl))}
              </span>
            </button>
          );
        })}
      </div>

      {/* selected-day per-bot breakdown */}
      {sel && (
        <div className="mt-3 border border-border bg-grid p-2.5">
          <div className="flex justify-between items-baseline mb-1.5 pb-1.5 border-b border-border/60">
            <span className="text-[11px] text-cyan uppercase tracking-[1px]">{fullDate(sel.day)}</span>
            <span className={`text-[12px] font-bold tabular-nums ${sel.netPnl > 0 ? "text-green" : sel.netPnl < 0 ? "text-red" : "text-dim"}`}>
              {sel.active ? `${signedUsd(sel.netPnl)} net` : "no activity"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {sel.bots.map((b) => {
              const has = b.pnl != null || b.activityCount > 0;
              return (
                <div key={b.bot} className="flex justify-between items-baseline text-[10px]">
                  <span className={has ? "text-muted" : "text-dim"}>{b.label}</span>
                  <span className="tabular-nums flex gap-2">
                    {b.pnl == null ? (
                      <span className="text-dim">{b.activityCount > 0 ? `${b.activityCount} order${b.activityCount > 1 ? "s" : ""}` : "—"}</span>
                    ) : (
                      <>
                        <span className={b.pnl > 0 ? "text-green" : b.pnl < 0 ? "text-red" : "text-dim"}>{signedUsd(b.pnl)}</span>
                        {b.returnPct != null && <span className="text-dim w-12 text-right">{pct(b.returnPct)}</span>}
                        {b.activityCount > 0 && <span className="text-dim w-14 text-right">{b.activityCount} trade{b.activityCount > 1 ? "s" : ""}</span>}
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
