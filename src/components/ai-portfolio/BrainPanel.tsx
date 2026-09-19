import { strategyDefinition } from "@/lib/ai-portfolio/registry";
import { BRAIN_BOT_KEYS, type BrainState } from "@/lib/ai-portfolio/brain";

const STATUS_COLOR: Record<string, string> = {
  APPLIED: "text-green",
  REJECTED: "text-red-400",
  PENDING: "text-amber",
};

function ageDays(iso: string): number | null {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return Number.isNaN(days) ? null : days;
}

export function BrainPanel({ states }: { states: Partial<Record<string, BrainState>> }) {
  return (
    <div className="mt-4">
      <div className="border-b border-border pb-1 mb-2">
        <span className="text-cyan text-[11px] uppercase tracking-[2px]">🧠 Brain — self-improvement loop</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {BRAIN_BOT_KEYS.map((key) => {
          const state = states[key];
          const def = strategyDefinition(key);
          return (
            <div key={key} className="border border-border bg-grid p-3">
              <div className="text-amber font-bold tracking-[1px] text-[11px] mb-1.5">
                ▸ {def.dashboardLabel}
              </div>
              {!state || !state.last_review ? (
                <div className="text-dim text-[11px]">No brain data published yet.</div>
              ) : (
                <>
                  <div className="text-muted text-[11px] mb-1">
                    Last review {state.last_review.date}
                    {ageDays(state.last_review.date) !== null && ` (${ageDays(state.last_review.date)}d ago)`} ·{" "}
                    {state.last_review.amendments_proposed} proposed
                  </div>
                  {state.last_review.review_md && (
                    <div className="text-dim text-[10px] leading-relaxed whitespace-pre-wrap mb-2 border-l-2 border-border pl-2">
                      {state.last_review.review_md}
                    </div>
                  )}
                  {state.recent_amendments.length === 0 ? (
                    <div className="text-dim text-[11px]">No amendments yet.</div>
                  ) : (
                    <div className="space-y-0.5">
                      {state.recent_amendments.map((a, i) => (
                        <div key={i} className="flex gap-2 text-[10px] leading-relaxed">
                          <span className={`${STATUS_COLOR[a.status] ?? "text-muted"} w-16 flex-shrink-0`}>
                            {a.status}
                          </span>
                          <span className="text-muted truncate">
                            {a.param} {a.from} → {a.to}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
