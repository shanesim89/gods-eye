import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Row, SectionLabel } from "@/components/ui/Row";
import { BigNum } from "@/components/ui/BigNum";
import { db } from "@/db/client";
import { assets, subscriptions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { convert } from "@/lib/fx";
import { fmtMoney, toMonthly, daysUntil } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MoneyMapPage() {
  const user = await requireUser();
  const base = user.base_currency;

  const [assetRows, subRows] = await Promise.all([
    db.select().from(assets).where(eq(assets.user_id, user.id)),
    db.select().from(subscriptions).where(eq(subscriptions.user_id, user.id)),
  ]);

  // ASSETS: cost basis as net-worth proxy (Phase 2 will swap to live price)
  const assetByClass: Record<string, number> = {};
  let assetTotal = 0;
  for (const a of assetRows) {
    const v = await convert(Number(a.cost_basis ?? 0), a.currency, base);
    assetByClass[a.asset_class] = (assetByClass[a.asset_class] ?? 0) + v;
    assetTotal += v;
  }

  // SUBS: monthly cost in base currency
  let monthlySubs = 0;
  for (const s of subRows) {
    const monthlyNative = toMonthly(Number(s.amount), s.cycle);
    monthlySubs += await convert(monthlyNative, s.currency, base);
  }

  // Upcoming charges (next 30d)
  const upcoming = subRows
    .filter((s) => s.next_charge && new Date(s.next_charge).getTime() > Date.now() - 86400_000)
    .sort((a, b) => new Date(a.next_charge!).getTime() - new Date(b.next_charge!).getTime())
    .slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:h-[calc(100vh-120px)]">
      <Panel
        title="NET WORTH"
        meta={`COST-BASIS · ${assetRows.length} POSITIONS`}
      >
        <BigNum
          currency={base}
          value={Math.round(assetTotal).toLocaleString("en-US")}
          delta={
            assetRows.length === 0
              ? "no assets yet — add at /money-map/assets"
              : `cost-basis view · live prices Phase 2`
          }
          deltaTone="green"
        />
        <SectionLabel>BREAKDOWN BY CLASS</SectionLabel>
        {Object.keys(assetByClass).length === 0 && (
          <Row k="—" v="add assets to populate" tone="muted" />
        )}
        {Object.entries(assetByClass).map(([cls, v]) => (
          <Row
            key={cls}
            k={cls}
            v={fmtMoney(v, base, 0)}
            tone={cls === "crypto" ? "amber" : "green"}
          />
        ))}
        <div className="mt-3 text-[10px] text-muted">
          <Link href="/money-map/assets" className="text-cyan hover:text-amber">
            ▸ manage assets
          </Link>
        </div>
      </Panel>

      <Panel title="CASH FLOW · OUTGOING" meta="PHASE 1 PARTIAL">
        <Row k="Subscriptions / mo" v={fmtMoney(monthlySubs, base, 2)} tone="amber" />
        <Row k="Fixed Expenses / mo" v="$ — (add Phase 1B)" tone="muted" />
        <Row k="DCA Invest / mo" v="$ — (add Phase 1B)" tone="muted" />
        <Row k="Loan Pmt / mo" v="$ — (add Phase 1B)" tone="muted" />
        <SectionLabel>SANKEY (Phase 1B)</SectionLabel>
        <div className="text-muted text-[11px] py-4 text-center border border-dim border-dashed mt-2">
          d3-sankey flow viz · pending income + fixed expenses entry
        </div>
      </Panel>

      <Panel
        title="COMMITMENTS"
        meta={`${subRows.length} SUBS · ${fmtMoney(monthlySubs, base, 0)}/MO`}
      >
        <Row k="Subscriptions" v={fmtMoney(monthlySubs, base, 2)} tone="amber" />
        <Row k="Fixed Exp" v="$ —" tone="muted" />
        <Row k="DCA Invest" v="$ —" tone="muted" />
        <Row k="Loan Pmt" v="$ —" tone="muted" />
        <SectionLabel>UPCOMING CHARGES</SectionLabel>
        {upcoming.length === 0 && (
          <div className="text-muted text-[11px] py-2">
            no scheduled charges — set next_charge on{" "}
            <Link href="/money-map/subscriptions" className="text-cyan">
              subs
            </Link>
          </div>
        )}
        {upcoming.map((s) => (
          <Row
            key={s.id}
            k={s.name}
            v={`${fmtMoney(Number(s.amount), s.currency, 2)} · ${daysUntil(
              s.next_charge
            )}`}
          />
        ))}
        <div className="mt-3 text-[10px] text-muted">
          <Link
            href="/money-map/subscriptions"
            className="text-cyan hover:text-amber"
          >
            ▸ manage subscriptions
          </Link>
        </div>
      </Panel>

      <Panel title="INCOME PULSE" meta="PHASE 1B">
        <BigNum currency="YTD" value="0" />
        <SectionLabel>NEXT INFLOWS</SectionLabel>
        <div className="text-muted text-[11px] py-4 text-center">
          add income sources in Phase 1B
        </div>
      </Panel>
    </div>
  );
}
