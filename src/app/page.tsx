import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { getBotOverview } from "@/lib/ai-portfolio/overview";
import { BotStatusRow } from "@/components/ai-portfolio/BotStatusRow";
import { BotBreakdownCard } from "@/components/ai-portfolio/BotBreakdownCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const bots = await getBotOverview(user.id);

  const alerts = bots.filter((b) => b.health !== "ok");

  return (
    <Panel title="AI PORTFOLIO" meta="ALL BOTS · LIVE + PAPER">
      <style>{`
        @keyframes blip{0%,100%{opacity:1}50%{opacity:.2}}
        .live-blip{animation:blip 1.4s ease-in-out infinite}
      `}</style>

      {/* health / alert banner — only when something needs attention */}
      {alerts.length > 0 && (
        <div className="border border-red/60 bg-red/5 px-3 py-2 mb-4 text-[10px] tracking-[0.5px]">
          <span className="text-red font-bold uppercase tracking-[1px] mr-2">⚠ Attention</span>
          <span className="text-muted">
            {alerts
              .map((b) => `${b.label} — ${b.healthNote ?? b.health}`)
              .join("  ·  ")}
          </span>
        </div>
      )}

      {/* per-bot status rows */}
      <div className="space-y-1.5 mb-5">
        {bots.map((bot) => (
          <BotStatusRow key={bot.key} bot={bot} />
        ))}
      </div>

      {/* per-bot breakdown cards */}
      <div className="text-dim text-[9px] uppercase tracking-[1.5px] mb-2">Breakdown · holdings · P/L · 24h activity</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {bots.map((bot) => (
          <BotBreakdownCard key={bot.key} bot={bot} />
        ))}
      </div>
    </Panel>
  );
}
