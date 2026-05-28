"use client";

import type { AgentResult, Signal } from "@/lib/council/types";

const SIGNAL_COLORS: Record<Signal, string> = {
  bull: "text-green border-green/40 bg-green/5",
  bear: "text-red border-red/40 bg-red/5",
  neutral: "text-muted border-border bg-grid",
};

const ROLE_ICONS: Record<string, string> = {
  TECHNICAL: "◈",
  FUNDAMENTAL: "◆",
  SENTIMENT: "◉",
  MACRO: "◎",
  "ON-CHAIN": "⬡",
  FLOW: "◈",
  RISK: "⚠",
};

type Props = {
  role: string;
  result?: AgentResult;
  loading?: boolean;
};

export function AgentPanel({ role, result, loading }: Props) {
  const icon = ROLE_ICONS[role] ?? "·";
  const signal = result?.signal;
  const signalClass = signal ? SIGNAL_COLORS[signal] : "";

  return (
    <div className="border border-border bg-grid p-2.5 flex flex-col gap-1.5 min-h-[110px]">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-muted uppercase tracking-[1px] flex items-center gap-1">
          <span className="text-amber">{icon}</span>
          {role}
        </div>
        {signal && (
          <span
            className={`text-[9px] border px-1.5 py-0.5 uppercase tracking-wider font-bold ${signalClass}`}
          >
            {signal}
          </span>
        )}
      </div>

      {/* Confidence bar */}
      {result && (
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-[3px] bg-border/40 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                signal === "bull"
                  ? "bg-green"
                  : signal === "bear"
                  ? "bg-red"
                  : "bg-muted"
              }`}
              style={{ width: `${result.confidence}%` }}
            />
          </div>
          <span className="text-[9px] tabular-nums text-dim w-6 text-right">
            {result.confidence}%
          </span>
        </div>
      )}

      {/* Thesis / loading state */}
      <div className="flex-1">
        {loading && !result && (
          <div className="text-[10px] text-dim italic animate-pulse">
            analyzing…
          </div>
        )}
        {result ? (
          <>
            <p className="text-[10px] text-text leading-relaxed line-clamp-3">
              {result.thesis}
            </p>
            {result.keyPoints.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {result.keyPoints.slice(0, 3).map((pt, i) => (
                  <li key={i} className="text-[9px] text-dim flex gap-1">
                    <span className="text-amber shrink-0">›</span>
                    <span className="leading-tight">{pt}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : !loading ? (
          <div className="text-[10px] text-dim italic">awaiting council…</div>
        ) : null}
      </div>
    </div>
  );
}
