import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Row, SectionLabel } from "@/components/ui/Row";
import { BigNum } from "@/components/ui/BigNum";
import { Sankey, type SankeyData } from "@/components/ui/Sankey";
import { db } from "@/db/client";
import {
  assets,
  subscriptions,
  fixed_expenses,
  liabilities,
  income_sources,
  investment_commitments,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { convert } from "@/lib/fx";
import { fmtMoney, fmtPct, toMonthly, daysUntil } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MoneyMapPage() {
  const user = await requireUser();
  const base = user.base_currency;

  const [assetRows, subRows, fxRows, liaRows, incRows, icRows] = await Promise.all([
    db.select().from(assets).where(eq(assets.user_id, user.id)),
    db.select().from(subscriptions).where(eq(subscriptions.user_id, user.id)),
    db.select().from(fixed_expenses).where(eq(fixed_expenses.user_id, user.id)),
    db.select().from(liabilities).where(eq(liabilities.user_id, user.id)),
    db.select().from(income_sources).where(eq(income_sources.user_id, user.id)),
    db.select().from(investment_commitments).where(eq(investment_commitments.user_id, user.id)),
  ]);

  // Asset totals + class breakdown
  const assetByClass: Record<string, number> = {};
  let assetTotal = 0;
  for (const a of assetRows) {
    const v = await convert(Number(a.cost_basis ?? 0), a.currency, base);
    assetByClass[a.asset_class] = (assetByClass[a.asset_class] ?? 0) + v;
    assetTotal += v;
  }

  // Liabilities total
  let liaTotal = 0;
  for (const l of liaRows) liaTotal += await convert(Number(l.balance), l.currency, base);

  const netWorth = assetTotal - liaTotal;

  // Monthly cash flows (all in base)
  let monthlyIncome = 0;
  for (const i of incRows)
    monthlyIncome += await convert(toMonthly(Number(i.amount), i.cycle), i.currency, base);

  let monthlySubs = 0;
  for (const s of subRows)
    monthlySubs += await convert(toMonthly(Number(s.amount), s.cycle), s.currency, base);

  let monthlyFx = 0;
  for (const f of fxRows)
    monthlyFx += await convert(toMonthly(Number(f.amount), f.cycle), f.currency, base);

  let monthlyDca = 0;
  for (const c of icRows)
    monthlyDca += await convert(toMonthly(Number(c.target_amount), c.cycle), c.currency, base);

  const monthlyOutflow = monthlySubs + monthlyFx + monthlyDca;
  const monthlyFree = monthlyIncome - monthlyOutflow;
  const savingsRate = monthlyIncome > 0 ? (monthlyFree / monthlyIncome) * 100 : 0;

  // Sankey data: Income types -> "Total" -> Outflow buckets + Free
  const incomeByType: Record<string, number> = {};
  for (const i of incRows) {
    const m = await convert(toMonthly(Number(i.amount), i.cycle), i.currency, base);
    incomeByType[i.type] = (incomeByType[i.type] ?? 0) + m;
  }

  const sankeyNodes: SankeyData["nodes"] = [];
  const sankeyLinks: SankeyData["links"] = [];

  if (monthlyIncome > 0) {
    // sources
    const typeColors: Record<string, string> = {
      salary: "#00ff7f",
      dividend: "#00e5ff",
      interest: "#00e5ff",
      rental: "#ffb000",
      side: "#ffb000",
      other: "#6b6b6b",
    };
    const sourceIdx: Record<string, number> = {};
    Object.entries(incomeByType).forEach(([type, val]) => {
      sourceIdx[type] = sankeyNodes.length;
      sankeyNodes.push({ name: type.toUpperCase(), color: typeColors[type] ?? "#00ff7f" });
    });

    const totalIdx = sankeyNodes.length;
    sankeyNodes.push({ name: "TOTAL", color: "#ffb000" });

    Object.entries(incomeByType).forEach(([type, val]) => {
      sankeyLinks.push({ source: sourceIdx[type], target: totalIdx, value: val });
    });

    // outflow categories
    const outflows: { label: string; value: number; color: string }[] = [
      { label: "FIXED", value: monthlyFx, color: "#ff3b3b" },
      { label: "SUBS", value: monthlySubs, color: "#ffb000" },
      { label: "DCA", value: monthlyDca, color: "#00e5ff" },
      { label: "FREE", value: Math.max(0, monthlyFree), color: "#00ff7f" },
    ].filter((o) => o.value > 0);

    for (const o of outflows) {
      const idx = sankeyNodes.length;
      sankeyNodes.push({ name: o.label, color: o.color });
      sankeyLinks.push({ source: totalIdx, target: idx, value: o.value });
    }
  }

  // Upcoming subs charges
  const upcoming = subRows
    .filter((s) => s.next_charge && new Date(s.next_charge).getTime() > Date.now() - 86400_000)
    .sort((a, b) => new Date(a.next_charge!).getTime() - new Date(b.next_charge!).getTime())
    .slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Panel
        title="NET WORTH"
        meta={`${assetRows.length} ASSETS · ${liaRows.length} LIABS`}
      >
        <BigNum
          currency={base}
          value={Math.round(netWorth).toLocaleString("en-US")}
          delta={`Assets ${fmtMoney(assetTotal, base, 0)} − Liabilities ${fmtMoney(liaTotal, base, 0)}`}
          deltaTone={netWorth >= 0 ? "green" : "red"}
        />
        <SectionLabel>ASSET BREAKDOWN</SectionLabel>
        {Object.keys(assetByClass).length === 0 && (
          <Row k="—" v="add assets to populate" tone="muted" />
        )}
        {Object.entries(assetByClass).map(([cls, v]) => (
          <Row
            key={cls}
            k={cls}
            v={`${fmtMoney(v, base, 0)} · ${assetTotal > 0 ? fmtPct((v / assetTotal) * 100, 1) : ""}`}
            tone={cls === "crypto" ? "amber" : "green"}
          />
        ))}
        <div className="mt-3 text-[10px] text-muted flex gap-4">
          <Link href="/money-map/assets" className="text-cyan hover:text-amber">▸ assets</Link>
          <Link href="/money-map/liabilities" className="text-cyan hover:text-amber">▸ liabilities</Link>
        </div>
      </Panel>

      <Panel title="CASH FLOW" meta={`SAVINGS RATE ${fmtPct(savingsRate, 1)}`}>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <div className="text-muted text-[10px] uppercase">Inflow / mo</div>
            <div className="text-green text-xl font-bold">+{fmtMoney(monthlyIncome, base, 0)}</div>
          </div>
          <div>
            <div className="text-muted text-[10px] uppercase">Outflow / mo</div>
            <div className="text-red text-xl font-bold">−{fmtMoney(monthlyOutflow, base, 0)}</div>
          </div>
        </div>
        <Row k="Net Free Cash" v={fmtMoney(monthlyFree, base, 2)} tone={monthlyFree >= 0 ? "amber" : "red"} />
        <SectionLabel>FLOW</SectionLabel>
        <Sankey data={{ nodes: sankeyNodes, links: sankeyLinks }} height={180} />
        <div className="mt-2 text-[10px] text-muted">
          <Link href="/money-map/cashflow" className="text-cyan hover:text-amber">▸ manage fixed / DCA</Link>
        </div>
      </Panel>

      <Panel
        title="COMMITMENTS"
        meta={`${fmtMoney(monthlyOutflow, base, 0)}/MO TOTAL`}
      >
        <Row k="Subscriptions" v={`${fmtMoney(monthlySubs, base, 2)}  (${subRows.length})`} tone="amber" />
        <Row k="Fixed Expenses" v={`${fmtMoney(monthlyFx, base, 2)}  (${fxRows.length})`} tone="red" />
        <Row k="DCA Invest" v={`${fmtMoney(monthlyDca, base, 2)}  (${icRows.length})`} tone="cyan" />
        <Row k="Liabilities (bal)" v={fmtMoney(liaTotal, base, 0)} tone="red" />
        <SectionLabel>UPCOMING CHARGES</SectionLabel>
        {upcoming.length === 0 && (
          <div className="text-muted text-[11px] py-2">
            no scheduled charges · set next_charge on{" "}
            <Link href="/money-map/subscriptions" className="text-cyan">subs</Link>
          </div>
        )}
        {upcoming.map((s) => (
          <Row
            key={s.id}
            k={s.name}
            v={`${fmtMoney(Number(s.amount), s.currency, 2)} · ${daysUntil(s.next_charge)}`}
          />
        ))}
      </Panel>

      <Panel
        title="INCOME PULSE"
        meta={`${incRows.length} SOURCES · ${fmtMoney(monthlyIncome, base, 0)}/MO`}
      >
        <BigNum
          currency={`${base}/yr`}
          value={Math.round(monthlyIncome * 12).toLocaleString("en-US")}
          delta={incRows.length === 0 ? "add sources at /money-map/income" : `${fmtMoney(monthlyIncome, base, 0)} per month run-rate`}
          deltaTone="green"
        />
        <SectionLabel>SOURCE MIX</SectionLabel>
        {Object.keys(incomeByType).length === 0 && (
          <Row k="—" v="add income to populate" tone="muted" />
        )}
        {Object.entries(incomeByType).map(([t, v]) => (
          <Row
            key={t}
            k={t}
            v={`${fmtMoney(v, base, 0)}/mo · ${monthlyIncome > 0 ? fmtPct((v / monthlyIncome) * 100, 1) : ""}`}
            tone="green"
          />
        ))}
        <div className="mt-3 text-[10px] text-muted">
          <Link href="/money-map/income" className="text-cyan hover:text-amber">▸ manage income</Link>
        </div>
      </Panel>
    </div>
  );
}
