import type { StageResult, IndicatorReading, ChangeSet } from "@/lib/market-stress/score";
import { classifyTrend } from "@/lib/market-stress/score";
import { statusColor, statusDot, statusLabel, INDICATOR_COPY, STAGE_EXPLAINER } from "./copy";

function fmtChange(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

function ChangeRow({ change }: { change: ChangeSet }) {
  return (
    <span className="font-mono text-[10px] text-dim flex gap-2.5">
      <span>1w {fmtChange(change.w1)}</span>
      <span>1m {fmtChange(change.m1)}</span>
      <span>3m {fmtChange(change.m3)}</span>
    </span>
  );
}

function IndicatorRow({ ind }: { ind: IndicatorReading }) {
  const copy = INDICATOR_COPY[ind.key];
  const trend = ind.quality === "OK" ? classifyTrend(ind.change, true) : "STABLE";

  return (
    <div className="dotted-row py-2.5 last:border-0">
      <div className="flex justify-between items-baseline gap-3">
        <span className="text-[12px] flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusDot[ind.status]}`} />
          {ind.label}
        </span>
        <span className="font-mono text-[12px]">
          {ind.quality === "UNAVAILABLE" ? (
            <span className="text-dim text-[11px]">data unavailable</span>
          ) : (
            <span className={statusColor[ind.status]}>{ind.value?.toFixed(2)}</span>
          )}
        </span>
      </div>
      {ind.quality !== "UNAVAILABLE" && (
        <div className="mt-1 flex justify-between items-baseline gap-3">
          <ChangeRow change={ind.change} />
          <span className="text-[10px] text-dim">
            {trend === "DETERIORATING_RAPIDLY" ? "deteriorating rapidly" : trend === "DETERIORATING" ? "deteriorating" : trend === "IMPROVING" ? "improving" : "stable"}
            {ind.percentile != null ? ` · ${ind.percentile}th pct (10y)` : ""}
          </span>
        </div>
      )}
      {ind.quality === "DATA_LIMITED" && (
        <div className="mt-1 text-[10px] text-dim">Data limited — sample coverage below target.</div>
      )}
      {copy && <p className="mt-1.5 text-[11px] text-muted leading-snug">{copy.whyItMatters}</p>}
    </div>
  );
}

export function StageCard({ stage, index }: { stage: StageResult; index: number }) {
  return (
    <div className="bg-panel border border-border rounded-xl overflow-hidden">
      <div className="px-3.5 pt-3 pb-2 flex justify-between items-baseline gap-3 text-[10px] tracking-[1.3px] text-dim uppercase">
        <span>
          Stage {index} · {stage.title}
        </span>
        <span className={`normal-case tracking-normal ${statusColor[stage.status]}`}>{statusLabel[stage.status]}</span>
      </div>
      <div className="px-3.5 pb-1 text-[11px] text-muted leading-snug">{STAGE_EXPLAINER[stage.id]}</div>
      <div className="px-3.5 pb-3.5">
        {stage.indicators.map((ind) => (
          <IndicatorRow key={ind.key} ind={ind} />
        ))}
      </div>
    </div>
  );
}
