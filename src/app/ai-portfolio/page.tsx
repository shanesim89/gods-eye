import Link from "next/link";
import { eq } from "drizzle-orm";
import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { ACTIVE_STRATEGIES, isRetiredInfraService } from "@/lib/ai-portfolio/registry";

export const dynamic = "force-dynamic";

type InfraStatus = {
  hostname: string;
  ip: string;
  uptime_seconds: number;
  services: Record<string, boolean>;
  generated_at: string;
};

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function getInfraStatus(): Promise<{ status: InfraStatus | null; ageMin: number | null }> {
  const rows = await db
    .select()
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, "infra:vps:status"))
    .limit(1);
  if (rows.length === 0) return { status: null, ageMin: null };
  const ageMin = (Date.now() - new Date(rows[0].fetched_at).getTime()) / 60000;
  return { status: rows[0].payload as InfraStatus, ageMin };
}

const badgeClass = {
  LIVE: "border-green/50 text-green",
  PAPER: "border-amber/50 text-amber",
} as const;

export default async function AiPortfolioPage() {
  await requireUser();
  const { status: infra, ageMin } = await getInfraStatus();
  const infraUp = infra != null && ageMin != null && ageMin < 10;
  const services = infra ? Object.entries(infra.services) : [];
  const activeServices = services.filter(([name]) => !isRetiredInfraService(name));
  const healthyCount = activeServices.filter(([, ok]) => ok).length;
  const downServices = activeServices.filter(([, ok]) => !ok);

  return (
    <Panel title="AI PORTFOLIO" meta="AUTOMATED TRADING">
      <div className="border border-border bg-grid p-3 mb-3 flex flex-wrap items-center justify-between gap-3 text-[11px]">
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={`text-[9px] uppercase tracking-[1px] px-1.5 py-0.5 border ${
              infraUp ? "border-green/50 text-green" : "border-red-500/50 text-red-400"
            }`}
          >
            {infraUp ? "● VPS UP" : infra ? "● VPS STALE" : "○ NO DATA"}
          </span>
          {infra && (
            <>
              <span className="text-muted">
                {infra.ip} · {infra.hostname}
              </span>
              <span className="text-muted">uptime {fmtUptime(infra.uptime_seconds)}</span>
              <span className="text-muted">
                bots {healthyCount}/{activeServices.length}
                {downServices.length > 0 && (
                  <span className="text-red-400">
                    {" "}
                    ({downServices.map(([name]) => name).join(", ")} down)
                  </span>
                )}
              </span>
              <span className="text-dim">checked {ageMin!.toFixed(1)}m ago</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {infra && (
            <span className="text-dim font-mono text-[10px]">ssh bots@{infra.ip}</span>
          )}
          <a
            href="https://console.hetzner.com/projects"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan hover:underline text-[10px] uppercase tracking-[1px]"
          >
            Hetzner Console ↗
          </a>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ACTIVE_STRATEGIES.map((strategy) => (
          <Link key={strategy.key} href={strategy.href}>
            <div className="border border-amber/40 hover:border-amber bg-grid p-4 h-full transition-colors">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-amber font-bold tracking-[1px] text-[12px]">
                  ▸ {strategy.dashboardLabel}
                </span>
                <span
                  className={`text-[9px] uppercase tracking-[1px] px-1.5 py-0.5 border ${badgeClass[strategy.mode]}`}
                >
                  {strategy.mode}
                </span>
              </div>
              <div className="text-muted text-[11px] leading-snug">
                {strategy.description}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </Panel>
  );
}
