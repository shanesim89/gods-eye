"use client";

import type { HomeState } from "@/lib/ai-portfolio/overview";
import { useLivePoll } from "@/app/ai-portfolio/_components/useLivePoll";
import { Panel } from "@/components/ui/Panel";
import { HeroStrip } from "./HeroStrip";
import { LiveMoneyColumn } from "./LiveMoneyColumn";
import { PaperFleetColumn } from "./PaperFleetColumn";
import { ProfitCalendar } from "./ProfitCalendar";
import { ActivityFeed } from "./ActivityFeed";

/** Homepage command center — polls /api/home/state every 20s like bot pages. */
export function HomeLive({ initial }: { initial: HomeState }) {
  const { state, secsAgo, updatedAt } = useLivePoll<HomeState>("/api/home/state", initial);
  const stale = secsAgo > 90;
  const liveValue = state.live.reduce((s, b) => s + b.equityOrValue, 0);

  return (
    <>
      <div className="flex items-center gap-2 mb-2 text-[11px]">
        <span className={`inline-flex items-center gap-1 ${stale ? "text-amber" : "text-green"}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${stale ? "bg-amber" : "bg-green animate-pulse"}`} />
          {stale ? "STALE" : "LIVE"}
        </span>
        <span className="text-dim">{updatedAt ? `updated ${secsAgo}s ago` : "polling every 20s"}</span>
      </div>

      {state.alerts.length > 1 && (
        <div className="border border-red/60 bg-red/5 px-3 py-2 mb-3 text-[11px] leading-relaxed">
          <span className="text-red font-bold uppercase tracking-[1px] mr-2">⚠ Attention</span>
          <span className="text-muted">{state.alerts.join("  ·  ")}</span>
        </div>
      )}

      <HeroStrip hero={state.hero} alerts={state.alerts} liveValue={liveValue} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
        <LiveMoneyColumn bots={state.live} />
        <PaperFleetColumn bots={state.paper} />
      </div>

      <div className="mt-4">
        <Panel title="30-DAY P/L CALENDAR" meta="net daily · click a day for per-bot breakdown">
          <ProfitCalendar daily={state.daily} />
        </Panel>
      </div>

      <ActivityFeed rows={state.activity} />
    </>
  );
}
