"use client";

import { useState } from "react";
import type { HomeActivityRow } from "@/lib/ai-portfolio/overview";
import { toneColor } from "@/components/ai-portfolio/format";

type Filter = "all" | "trades" | "skips" | "errors";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "trades", label: "TRADES" },
  { id: "skips", label: "SKIPS" },
  { id: "errors", label: "ERRORS" },
];

// Stable per-bot label color so the feed is scannable by system.
const BOT_COLOR: Record<string, string> = {
  crypto: "text-green",
  options: "text-amber",
  quant: "text-amber",
  gold: "text-cyan",
  pdhl: "text-cyan",
  pdhl4h: "text-cyan",
  pdhl8h: "text-cyan",
  dipbounce: "text-purple",
};

function matches(row: HomeActivityRow, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "trades") return row.tone === "buy" || row.tone === "sell";
  if (f === "skips") return row.tone === "skip" || row.tone === "info";
  return row.tone === "error";
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toISOString().slice(11, 16) + "Z"
    : "--:--";
}

/** Unified chronological 48h feed across all bots, client-side filterable. */
export function ActivityFeed({ rows }: { rows: HomeActivityRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = rows.filter((r) => matches(r, filter));

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 border-b border-border pb-1 mb-2">
        <span className="text-cyan text-[11px] uppercase tracking-[2px]">▤ Activity — last 48h</span>
        <div className="flex gap-1 ml-auto">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`text-[10px] tracking-[1px] px-2 py-0.5 border ${
                filter === f.id ? "border-cyan text-cyan" : "border-border text-dim hover:text-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="text-dim text-[11px] py-2">Nothing matching in the last 48h.</div>
      ) : (
        <div className="space-y-0.5">
          {visible.map((r, i) => (
            <div key={`${r.ts}-${r.bot}-${i}`} className="flex gap-2 text-[11px] leading-relaxed dotted-row py-0.5">
              <span className="text-dim tabular-nums w-12 flex-shrink-0">{hhmm(r.ts)}</span>
              <span className={`${BOT_COLOR[r.bot] ?? "text-muted"} w-28 flex-shrink-0 truncate tracking-[0.5px]`}>
                {r.botLabel}
              </span>
              <span className={`${toneColor[r.tone] ?? "text-muted"} flex-shrink-0`}>{r.label}</span>
              <span className="text-muted truncate">{r.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
