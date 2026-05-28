import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Gauge } from "@/components/ui/Gauge";
import { FlowParticles } from "@/components/ui/FlowParticles";
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
import { fmtMoney, fmtPct, toMonthly, daysUntil, timeAgo } from "@/lib/format";
import { hasStaleAssets, refreshUserAssets } from "@/lib/refresh-assets";

export const dynamic = "force-dynamic";

type Event = {
  id: string;
  title: string;
  sub: string;
  amount: number;
  currency: string;
  amountBase: number;
  dir: "in" | "out";
  date: Date;
};

export default async function MoneyMapPage() {
  const user = await requireUser();
  const base = user.base_currency;

  // Fire-and-forget refresh if any tickerable asset is stale (>30min).
  // Does not block render — next visit will show fresh values.
  hasStaleAssets(user.id)
    .then((stale) => {
      if (stale) refreshUserAssets(user.id).catch(() => {});
    })
    .catch(() => {});

  const [assetRows, subRows, fxRows, liaRows, incRows, icRows] = await Promise.all([
    db.select().from(assets).where(eq(assets.user_id, user.id)),
    db.select().from(subscriptions).where(eq(subscriptions.user_id, user.id)),
    db.select().from(fixed_expenses).where(eq(fixed_expenses.user_id, user.id)),
    db.select().from(liabilities).where(eq(liabilities.user_id, user.id)),
    db.select().from(income_sources).where(eq(income_sources.user_id, user.id)),
    db.select().from(investment_commitments).where(eq(investment_commitments.user_id, user.id)),
  ]);

  // ASSET totals (prefer current_value if set, fallback cost_basis)
  const assetByClass: Record<string, number> = {};
  let assetTotal = 0;
  for (const a of assetRows) {
    const native = a.current_value !== null ? Number(a.current_value) : Number(a.cost_basis ?? 0);
    const v = await convert(native, a.currency, base);
    assetByClass[a.asset_class] = (assetByClass[a.asset_class] ?? 0) + v;
    assetTotal += v;
  }

  // LIABILITIES total
  let liaTotal = 0;
  for (const l of liaRows) liaTotal += await convert(Number(l.balance), l.currency, base);
  const netWorth = assetTotal - liaTotal;

  // CASH FLOW monthly
  let monthlyIncome = 0;
  const incomeByType: Record<string, number> = {};
  for (const i of incRows) {
    const m = await convert(toMonthly(Number(i.amount), i.cycle), i.currency, base);
    monthlyIncome += m;
    incomeByType[i.type] = (incomeByType[i.type] ?? 0) + m;
  }
  let monthlySubs = 0;
  for (const s of subRows) monthlySubs += await convert(toMonthly(Number(s.amount), s.cycle), s.currency, base);
  let monthlyFx = 0;
  for (const f of fxRows) monthlyFx += await convert(toMonthly(Number(f.amount), f.cycle), f.currency, base);
  let monthlyDca = 0;
  for (const c of icRows) monthlyDca += await convert(toMonthly(Number(c.target_amount), c.cycle), c.currency, base);
  // Loan payments
  let monthlyLoan = 0;
  for (const l of liaRows) {
    if (l.monthly_payment !== null) monthlyLoan += await convert(Number(l.monthly_payment), l.currency, base);
  }

  const monthlyOutflow = monthlySubs + monthlyFx + monthlyDca + monthlyLoan;
  const monthlyFree = monthlyIncome - monthlyOutflow;
  const savingsRate = monthlyIncome > 0 ? (monthlyFree / monthlyIncome) * 100 : 0;

  // Gauges
  const annualExpenses = monthlyOutflow * 12;
  const fireTarget = annualExpenses * 25; // 4% rule
  const fireProgress = fireTarget > 0 ? Math.max(0, Math.min(1, netWorth / fireTarget)) : 0;
  const runwayMonths = monthlyOutflow > 0 ? netWorth / monthlyOutflow : 0;
  const debtRatio = assetTotal > 0 ? liaTotal / assetTotal : 0;

  // Event feed: upcoming inflows + outflows over next ~30d
  const now = Date.now();
  const horizon = 60 * 24 * 60 * 60 * 1000; // 60 days
  const events: Event[] = [];

  // Subs with next_charge
  for (const s of subRows) {
    if (!s.next_charge) continue;
    const d = new Date(s.next_charge);
    if (d.getTime() < now - 86400_000 || d.getTime() > now + horizon) continue;
    const amt = Number(s.amount);
    const ab = await convert(amt, s.currency, base);
    events.push({
      id: `sub-${s.id}`,
      title: s.name,
      sub: "subscription · auto-charge",
      amount: amt,
      currency: s.currency,
      amountBase: ab,
      dir: "out",
      date: d,
    });
  }

  // Income (next expected: assume monthly = +30d from now, except those without next_charge concept; approximate by adding 30d)
  for (const i of incRows) {
    // monthly cycle → next paydate guess: 5 days from now (we don't store paydate yet); shown as ETA
    const days = i.cycle === "monthly" ? 7 : i.cycle === "weekly" ? 3 : i.cycle === "yearly" ? 60 : 10;
    const d = new Date(now + days * 86400_000);
    const m = toMonthly(Number(i.amount), i.cycle);
    events.push({
      id: `inc-${i.id}`,
      title: i.name,
      sub: `${i.type} · ${i.cycle}`,
      amount: Number(i.amount),
      currency: i.currency,
      amountBase: await convert(m, i.currency, base) * (i.cycle === "monthly" ? 1 : 1),
      dir: "in",
      date: d,
    });
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Flow particle data
  const flowIncomes = Object.entries(incomeByType).slice(0, 5).map(([type, v]) => ({
    label: type,
    value: fmtMoney(v, base, 0),
    color:
      type === "salary" ? "#00ff7f" :
      type === "dividend" ? "#00e5ff" :
      type === "rental" ? "#ffb000" :
      type === "side" ? "#ffb000" : "#6b6b6b",
    align: "left" as const,
  }));
  const flowOutflows = [
    { label: "FIXED", value: fmtMoney(monthlyFx, base, 0), color: "#ff3b3b", align: "right" as const },
    { label: "SUBS", value: fmtMoney(monthlySubs, base, 0), color: "#ffb000", align: "right" as const },
    { label: "DCA", value: fmtMoney(monthlyDca, base, 0), color: "#00e5ff", align: "right" as const },
    { label: "LOAN", value: fmtMoney(monthlyLoan, base, 0), color: "#ff3b3b", align: "right" as const },
    { label: "FREE", value: fmtMoney(Math.max(0, monthlyFree), base, 0), color: "#00ff7f", align: "right" as const },
  ].filter((o) => o.value !== fmtMoney(0, base, 0));

  // Asset mix percentages
  const mixSorted = Object.entries(assetByClass).sort((a, b) => b[1] - a[1]);

  // Top subs
  const topSubs = await Promise.all(
    subRows.map(async (s) => ({
      name: s.name,
      monthly: await convert(toMonthly(Number(s.amount), s.cycle), s.currency, base),
    }))
  );
  topSubs.sort((a, b) => b.monthly - a.monthly);

  return (
    <div className="flex flex-col gap-3">

      {/* HERO STRIP */}
      <div className="bg-panel border border-border">
        <div className="bg-black border-b border-border px-3 py-1.5 flex justify-between items-center text-[10px] tracking-[1.5px] text-amber uppercase">
          <span>◢ MISSION VITALS</span>
          <span className="text-muted">REAL-TIME · UPDATED {new Date().toISOString().slice(11, 19)} UTC</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5">
          <div className="p-4 border-r border-border last:border-r-0">
            <div className="text-[9px] tracking-[1.5px] uppercase text-muted">NET WORTH</div>
            <div className={`text-2xl md:text-3xl font-bold tabular-nums ${netWorth >= 0 ? "text-text" : "text-red"}`}>{fmtMoney(netWorth, base, 0)}</div>
            <div className={`text-[10px] mt-1 ${netWorth >= 0 ? "text-green" : "text-red"}`}>
              {assetRows.length} assets · {liaRows.length} liabs
            </div>
          </div>
          <div className="p-4 border-r border-border">
            <div className="text-[9px] tracking-[1.5px] uppercase text-muted">ASSETS</div>
            <div className="text-xl md:text-2xl font-bold tabular-nums text-green">{fmtMoney(assetTotal, base, 0)}</div>
            <div className="text-[10px] mt-1 text-muted">
              {assetRows.length} positions
              {(() => {
                const lp = assetRows.map((a) => a.last_priced_at).filter(Boolean) as (Date | string)[];
                if (lp.length === 0) return null;
                const latest = lp.reduce<Date>((max, d) => {
                  const dt = typeof d === "string" ? new Date(d) : d;
                  return dt > max ? dt : max;
                }, new Date(0));
                if (latest.getTime() === 0) return null;
                return <span className="text-amber"> · live {timeAgo(latest)}</span>;
              })()}
            </div>
          </div>
          <div className="p-4 border-r border-border">
            <div className="text-[9px] tracking-[1.5px] uppercase text-muted">DEBT</div>
            <div className="text-xl md:text-2xl font-bold tabular-nums text-red">{liaTotal === 0 ? "—" : fmtMoney(liaTotal, base, 0)}</div>
            <div className="text-[10px] mt-1 text-muted">{liaRows.length} loans</div>
          </div>
          <div className="p-4 border-r border-border">
            <div className="text-[9px] tracking-[1.5px] uppercase text-muted">MO INCOME</div>
            <div className="text-xl md:text-2xl font-bold tabular-nums text-green">{fmtMoney(monthlyIncome, base, 0)}</div>
            <div className="text-[10px] mt-1 text-amber">savings {fmtPct(savingsRate, 1)}</div>
          </div>
          <div className="p-4">
            <div className="text-[9px] tracking-[1.5px] uppercase text-muted">MO BURN</div>
            <div className="text-xl md:text-2xl font-bold tabular-nums text-red">{fmtMoney(monthlyOutflow, base, 0)}</div>
            <div className="text-[10px] mt-1 text-muted">{subRows.length} subs · {fxRows.length} fixed · {icRows.length} dca</div>
          </div>
        </div>

        {/* GAUGES */}
        <div className="border-t border-border bg-bg p-4 flex flex-wrap justify-around gap-4">
          <Gauge
            value={Math.max(0, Math.min(1, savingsRate / 100))}
            label="SAVINGS RATE"
            display={`${Math.round(savingsRate)}%`}
            color="#00ff7f"
          />
          <Gauge
            value={fireProgress}
            label="FIRE PROGRESS"
            display={`${Math.round(fireProgress * 100)}%`}
            color="#ffb000"
          />
          <Gauge
            value={Math.max(0, Math.min(1, runwayMonths / 60))}
            label={`RUNWAY · TARGET 60mo`}
            display={runwayMonths === Infinity || isNaN(runwayMonths) ? "∞" : `${Math.round(runwayMonths)}mo`}
            color="#00e5ff"
          />
          <Gauge
            value={debtRatio}
            label="DEBT / ASSET"
            display={`${Math.round(debtRatio * 100)}%`}
            color="#b066ff"
          />
        </div>
      </div>

      {/* MAIN: flow + event feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <Panel title="MONEY FLOW" meta={`SAVINGS RATE ${fmtPct(savingsRate, 1)}`}>
            {flowIncomes.length === 0 || flowOutflows.length === 0 ? (
              <div className="text-muted text-[11px] py-10 text-center border border-dim border-dashed">
                add income + expenses to see flow
              </div>
            ) : (
              <FlowParticles
                incomes={flowIncomes}
                outflows={flowOutflows}
                centerLabel="NET WORTH"
                centerValue={fmtMoney(netWorth, base, 0)}
              />
            )}
          </Panel>
        </div>

        <Panel title="EVENT FEED" meta={`NEXT 60D · ${events.length}`}>
          {events.length === 0 && (
            <div className="text-muted text-[11px] py-4">no upcoming events yet</div>
          )}
          <div className="flex flex-col">
            {events.slice(0, 14).map((e) => (
              <div key={e.id} className="grid grid-cols-[28px_1fr_auto] gap-2 py-2 dotted-row items-center text-[11px]">
                <div className={`w-7 h-7 border flex items-center justify-center text-base ${e.dir === "in" ? "text-green border-green" : "text-red border-red"}`}>
                  {e.dir === "in" ? "▲" : "▼"}
                </div>
                <div className="min-w-0">
                  <div className="text-text truncate">{e.title}</div>
                  <div className="text-muted text-[9px] truncate">{e.sub}</div>
                </div>
                <div className="text-right whitespace-nowrap">
                  <div className={`font-bold tabular-nums ${e.dir === "in" ? "text-green" : "text-red"}`}>
                    {e.dir === "in" ? "+" : "−"}{fmtMoney(Math.abs(e.amount), e.currency, 0)}
                  </div>
                  <div className="text-muted text-[9px]">{daysUntil(e.date)}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* BOTTOM: 3 mini panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Panel title="ASSET MIX" meta={`${assetRows.length} POSITIONS`}>
          {mixSorted.length === 0 && (
            <div className="text-muted text-[11px]">
              add at <Link href="/money-map/assets" className="text-cyan">/money-map/assets</Link>
            </div>
          )}
          {mixSorted.map(([cls, v]) => {
            const pct = assetTotal > 0 ? (v / assetTotal) * 100 : 0;
            return (
              <div key={cls} className="mb-2">
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted uppercase">{cls}</span>
                  <span className="text-amber">{fmtMoney(v, base, 0)} · {pct.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 bg-grid mt-1">
                  <div className="h-full bg-amber" style={{ width: `${pct}%` }}></div>
                </div>
              </div>
            );
          })}
        </Panel>

        <Panel title="TOP SUBSCRIPTIONS" meta={`${subRows.length} ACTIVE`}>
          {topSubs.length === 0 && (
            <div className="text-muted text-[11px]">
              add at <Link href="/money-map/subscriptions" className="text-cyan">/money-map/subscriptions</Link>
            </div>
          )}
          {topSubs.slice(0, 6).map((s) => (
            <div key={s.name} className="flex justify-between dotted-row py-1 text-[11px]">
              <span className="text-text truncate">{s.name}</span>
              <span className="text-amber tabular-nums whitespace-nowrap">{fmtMoney(s.monthly, base, 0)}/mo</span>
            </div>
          ))}
          {topSubs.length > 6 && (
            <div className="text-muted text-[10px] mt-2">
              + {topSubs.length - 6} more · total {fmtMoney(monthlySubs, base, 0)}/mo
            </div>
          )}
        </Panel>

        <Panel title="FIRE PROGRESS" meta="4% RULE · 25× ANNUAL">
          <div className="text-center py-2">
            <div className="text-4xl font-bold tabular-nums text-amber">{Math.round(fireProgress * 100)}%</div>
            <div className="text-[10px] text-muted mt-2 uppercase tracking-[1px]">target {fmtMoney(fireTarget, base, 0)}</div>
            {monthlyFree > 0 && fireTarget > 0 && netWorth < fireTarget && (
              <div className="text-[10px] text-green mt-1">
                ETA ~{Math.ceil((fireTarget - netWorth) / monthlyFree)} months at current rate
              </div>
            )}
            {monthlyFree <= 0 && (
              <div className="text-[10px] text-red mt-1">negative cash flow · ETA undefined</div>
            )}
          </div>
        </Panel>
      </div>

      {/* Quick links footer */}
      <div className="text-[10px] text-muted flex flex-wrap gap-4 px-1">
        <Link href="/money-map/assets" className="text-cyan hover:text-amber">▸ assets</Link>
        <Link href="/money-map/liabilities" className="text-cyan hover:text-amber">▸ liabilities</Link>
        <Link href="/money-map/income" className="text-cyan hover:text-amber">▸ income</Link>
        <Link href="/money-map/subscriptions" className="text-cyan hover:text-amber">▸ subscriptions</Link>
        <Link href="/money-map/cashflow" className="text-cyan hover:text-amber">▸ fixed / dca</Link>
      </div>
    </div>
  );
}
