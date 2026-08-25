import Link from "next/link";
import { eq } from "drizzle-orm";
import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";

export const dynamic = "force-dynamic";

type InfraStatus = {
  hostname: string;
  ip: string;
  uptime_seconds: number;
  services: Record<string, boolean>;
  generated_at: string;
};

type Dashboard = {
  href: string | null;
  label: string;
  desc: string;
  badge: "LIVE" | "PAPER" | "SOON";
};

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function isBenchedService(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    (normalized.includes("pdhl4h") || normalized.includes("pdhl8h")) ||
    ((normalized.includes("pdhpdl") || normalized.includes("pdhl")) &&
      (normalized.includes("4h") || normalized.includes("8h")))
  );
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

const DASHBOARDS: Dashboard[] = [
  {
    href: "/ai-portfolio/crypto",
    label: "CRYPTO",
    desc: "BTC · ETH · SOL · HYPE — live bi-weekly DCA + council buy-zone boost.",
    badge: "LIVE",
  },
  { href: null, label: "ETF / UNIT TRUST", desc: "Coming soon", badge: "SOON" },
  { href: null, label: "STOCKS", desc: "Coming soon", badge: "SOON" },
  {
    href: "/ai-portfolio/options",
    label: "OPTIONS",
    desc: "The Wheel + council long plays — paper trading. Defined-risk income.",
    badge: "PAPER",
  },
  {
    href: "/ai-portfolio/quant-scalper",
    label: "QUANT SCALPER",
    desc: "Paper-forward research-gated quant bot — TSMOM BTC/ETH/BNB.",
    badge: "PAPER",
  },
  {
    href: "/ai-portfolio/gold-scalper",
    label: "GOLD PRINTING MACHINES",
    desc: "XAUUSD long+short 1m session-VWAP fade — paper-forward and self-tuning.",
    badge: "PAPER",
  },
  {
    href: "/ai-portfolio/pdhl-scalper",
    label: "PDH/PDL SCALPER",
    desc: "Daily break+retest is paper-active. 4H and 8H variants are OFF · BENCHED.",
    badge: "PAPER",
  },
];

const badgeClass: Record<Dashboard["badge"], string> = {
  LIVE: "border-green/50 text-green",
  PAPER: "border-amber/50 text-amber",
  SOON: "border-border text-dim",
};

export default async function AiPortfolioPage() {
  await requireUser();
  const { status: infra, ageMin } = await getInfraStatus();
  const infraUp = infra != null && ageMin != null && ageMin < 10;
  const services = infra ? Object.entries(infra.services) : [];
  const benchedServices = services.filter(([name]) => isBenchedService(name));
  const activeServices = services.filter(([name]) => !isBenchedService(name));
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
              {benchedServices.length > 0 && (
                <span className="text-dim">
                  {benchedServices.length} OFF · BENCHED
                </span>
              )}
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
        {DASHBOARDS.map((d) => {
          const available = d.href != null;
          const inner = (
            <div
              className={`border bg-grid p-4 h-full transition-colors ${
                available ? "border-amber/40 hover:border-amber" : "border-border opacity-50"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-amber font-bold tracking-[1px] text-[12px]">▸ {d.label}</span>
                <span
                  className={`text-[9px] uppercase tracking-[1px] px-1.5 py-0.5 border ${badgeClass[d.badge]}`}
                >
                  {d.badge}
                </span>
              </div>
              <div className="text-muted text-[11px] leading-snug">{d.desc}</div>
            </div>
          );
          return d.href ? (
            <Link key={d.label} href={d.href}>
              {inner}
            </Link>
          ) : (
            <div key={d.label}>{inner}</div>
          );
        })}
      </div>
    </Panel>
  );
}
