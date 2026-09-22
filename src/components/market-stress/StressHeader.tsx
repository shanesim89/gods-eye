import type { MarketStressState } from "@/lib/market-stress";
import { riskLevel } from "@/lib/market-stress/score";
import { statusColor, statusDot, statusLabel, scoreNarrative } from "./copy";

const RISK_COLOR: Record<ReturnType<typeof riskLevel>, string> = {
  LOW: "text-green",
  MODERATE: "text-amber",
  ELEVATED: "text-amber",
  HIGH: "text-red",
  SEVERE: "text-red",
};

export function StressHeader({ state }: { state: MarketStressState }) {
  const narrative = scoreNarrative(
    state.score,
    state.shockOverride ? "Shock-override: an extreme single-indicator reading has jumped the stage ahead of normal sequence." : "",
  );

  return (
    <div className="bg-panel border border-border rounded-xl hud-glow overflow-hidden">
      <div className="px-3.5 pt-3 pb-2 flex justify-between items-baseline gap-3 text-[10px] tracking-[1.3px] text-dim uppercase">
        <span>Market stress stage</span>
        <span className="normal-case tracking-normal text-right">
          stage {state.stage}/6{state.shockOverride ? " · shock override" : ""}
        </span>
      </div>
      <div className="px-3.5 pb-3.5">
        <div className="flex flex-wrap items-baseline gap-6 py-1">
          <div>
            <div className="text-dim text-[10px] uppercase tracking-[1px]">Risk score</div>
            <div className="text-[26px] font-semibold font-mono leading-tight mt-0.5">{state.score}</div>
            <div className={`text-[11px] font-medium ${RISK_COLOR[state.riskLevel]}`}>{state.riskLevel}</div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {state.stages.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5" title={`Stage ${s.id} · ${s.title} · ${statusLabel[s.status]}`}>
                <span className={`inline-block w-2 h-2 rounded-full ${statusDot[s.status]}`} />
                <span className="text-[10px] text-dim">{s.id}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[12px] text-muted leading-snug">{narrative}</p>
        <p className="mt-2 text-[10px] text-dim leading-snug">
          This tracks current conditions across rates, breadth, credit, earnings, trend, and systemic stress. It does not predict a crash or its timing — only where conditions sit right now relative to history.
        </p>
      </div>
    </div>
  );
}
