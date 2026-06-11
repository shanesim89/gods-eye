import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DASHBOARDS = [
  {
    href: "/ai-portfolio/crypto",
    label: "CRYPTO",
    desc: "BTC · ETH · SOL · HYPE — bi-weekly DCA + council buy-zone boost",
    live: true,
  },
  { href: null, label: "ETF / UNIT TRUST", desc: "Coming soon", live: false },
  { href: null, label: "STOCKS", desc: "Coming soon", live: false },
  { href: "/ai-portfolio/options", label: "OPTIONS", desc: "The Wheel + council long plays — PAPER. Defined-risk income.", live: true },
];

export default async function AiPortfolioPage() {
  await requireUser();

  return (
    <Panel title="AI PORTFOLIO" meta="AUTOMATED TRADING">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {DASHBOARDS.map((d) => {
          const inner = (
            <div
              className={`border bg-grid p-4 h-full transition-colors ${
                d.live
                  ? "border-amber/40 hover:border-amber"
                  : "border-border opacity-50"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-amber font-bold tracking-[1px] text-[12px]">▸ {d.label}</span>
                <span
                  className={`text-[9px] uppercase tracking-[1px] px-1.5 py-0.5 border ${
                    d.live ? "border-green/50 text-green" : "border-border text-dim"
                  }`}
                >
                  {d.live ? "LIVE" : "SOON"}
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
