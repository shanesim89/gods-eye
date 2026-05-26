import { Panel } from "@/components/ui/Panel";
import { db } from "@/db/client";
import { income_sources } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { convert } from "@/lib/fx";
import { fmtMoney, toMonthly } from "@/lib/format";
import { AddForm } from "./AddForm";
import { IncRow } from "./Row";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const base = user.base_currency;
  const rows = await db
    .select()
    .from(income_sources)
    .where(eq(income_sources.user_id, user.id))
    .orderBy(asc(income_sources.type), asc(income_sources.name));

  const enriched = await Promise.all(
    rows.map(async (r) => {
      const monthly = await convert(toMonthly(Number(r.amount), r.cycle), r.currency, base);
      return {
        id: r.id, name: r.name, amount: r.amount, currency: r.currency,
        cycle: r.cycle, type: r.type, monthly,
      };
    })
  );
  const totalMonthly = enriched.reduce((s, r) => s + r.monthly, 0);
  const byType = enriched.reduce<Record<string, number>>((acc, r) => {
    acc[r.type] = (acc[r.type] ?? 0) + r.monthly;
    return acc;
  }, {});

  return (
    <Panel
      title="INCOME SOURCES"
      meta={`${rows.length} SOURCES · ${fmtMoney(totalMonthly, base, 0)}/MO`}
    >
      <AddForm />
      {Object.keys(byType).length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3 text-[10px]">
          {Object.entries(byType).map(([t, v]) => (
            <span key={t} className="border border-border bg-grid px-2 py-0.5 text-muted uppercase">
              {t}: <span className="text-green">{fmtMoney(v, base, 0)}/mo</span>
            </span>
          ))}
        </div>
      )}
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-muted uppercase tracking-[0.5px]">
            <th className="text-left py-1 border-b border-border font-normal">SOURCE</th>
            <th className="text-left py-1 border-b border-border font-normal pl-3">TYPE</th>
            <th className="text-right py-1 border-b border-border font-normal pl-3">AMOUNT</th>
            <th className="text-left py-1 border-b border-border font-normal pl-3">CYCLE</th>
            <th className="text-right py-1 border-b border-border font-normal pl-3">MONTHLY ({base})</th>
            <th className="text-right py-1 border-b border-border font-normal pl-3 w-20">ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {enriched.length === 0 && (
            <tr><td colSpan={6} className="text-muted text-center py-4 italic">no income sources yet</td></tr>
          )}
          {enriched.map((r) => <IncRow key={r.id} r={r} base={base} />)}
        </tbody>
      </table>
    </Panel>
  );
}
