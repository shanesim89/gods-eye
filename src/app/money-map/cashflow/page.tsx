import { Panel } from "@/components/ui/Panel";
import { db } from "@/db/client";
import { fixed_expenses, investment_commitments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { convert } from "@/lib/fx";
import { fmtMoney, toMonthly } from "@/lib/format";
import { FixedExpenseForm, CommitmentForm } from "./Forms";
import { FxRow, IcRow } from "./Rows";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const base = user.base_currency;

  const [fxRows, icRows] = await Promise.all([
    db.select().from(fixed_expenses).where(eq(fixed_expenses.user_id, user.id)).orderBy(asc(fixed_expenses.name)),
    db.select().from(investment_commitments).where(eq(investment_commitments.user_id, user.id)).orderBy(asc(investment_commitments.name)),
  ]);

  const fxEnriched = await Promise.all(
    fxRows.map(async (r) => ({
      id: r.id, name: r.name, amount: r.amount, currency: r.currency, cycle: r.cycle,
      monthly: await convert(toMonthly(Number(r.amount), r.cycle), r.currency, base),
    }))
  );
  const icEnriched = await Promise.all(
    icRows.map(async (r) => ({
      id: r.id, name: r.name, target_amount: r.target_amount, currency: r.currency, cycle: r.cycle,
      monthly: await convert(toMonthly(Number(r.target_amount), r.cycle), r.currency, base),
    }))
  );

  const fxTotal = fxEnriched.reduce((s, r) => s + r.monthly, 0);
  const icTotal = icEnriched.reduce((s, r) => s + r.monthly, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Panel title="FIXED EXPENSES" meta={`${fxRows.length} ITEMS · ${fmtMoney(fxTotal, base, 0)}/MO`}>
        <FixedExpenseForm />
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-muted uppercase tracking-[0.5px]">
              <th className="text-left py-1 border-b border-border font-normal">NAME</th>
              <th className="text-right py-1 border-b border-border font-normal">AMOUNT</th>
              <th className="text-left py-1 border-b border-border font-normal pl-3">CYCLE</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3">MONTHLY ({base})</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3 w-20">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {fxEnriched.length === 0 && (
              <tr><td colSpan={5} className="text-muted text-center py-4 italic">no fixed expenses yet</td></tr>
            )}
            {fxEnriched.map((r) => <FxRow key={r.id} r={r} base={base} />)}
          </tbody>
        </table>
      </Panel>

      <Panel title="INVESTMENT COMMITMENTS (DCA)" meta={`${icRows.length} ITEMS · ${fmtMoney(icTotal, base, 0)}/MO`}>
        <CommitmentForm />
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-muted uppercase tracking-[0.5px]">
              <th className="text-left py-1 border-b border-border font-normal">NAME</th>
              <th className="text-right py-1 border-b border-border font-normal">TARGET</th>
              <th className="text-left py-1 border-b border-border font-normal pl-3">CYCLE</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3">MONTHLY ({base})</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3 w-20">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {icEnriched.length === 0 && (
              <tr><td colSpan={5} className="text-muted text-center py-4 italic">no commitments yet</td></tr>
            )}
            {icEnriched.map((r) => <IcRow key={r.id} r={r} base={base} />)}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
