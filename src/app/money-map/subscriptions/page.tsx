import { Panel } from "@/components/ui/Panel";
import { db } from "@/db/client";
import { subscriptions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { convert } from "@/lib/fx";
import { fmtMoney, toMonthly } from "@/lib/format";
import { AddForm } from "./AddForm";
import { SubRow } from "./Row";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.user_id, user.id))
    .orderBy(asc(subscriptions.next_charge));

  const enriched = await Promise.all(
    rows.map(async (r) => {
      const monthlyNative = toMonthly(Number(r.amount), r.cycle);
      const monthlyBase = await convert(monthlyNative, r.currency, user.base_currency);
      return {
        id: r.id,
        name: r.name,
        amount: r.amount,
        currency: r.currency,
        cycle: r.cycle,
        next_charge: r.next_charge,
        monthlyBase,
      };
    })
  );

  const totalMonthlyBase = enriched.reduce((sum, r) => sum + r.monthlyBase, 0);

  return (
    <Panel
      title="SUBSCRIPTIONS"
      meta={`${rows.length} ACTIVE · ${fmtMoney(totalMonthlyBase, user.base_currency, 0)}/MO`}
    >
      <AddForm />

      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-muted uppercase tracking-[0.5px]">
            <th className="text-left py-1 border-b border-border font-normal">SERVICE</th>
            <th className="text-right py-1 border-b border-border font-normal">AMOUNT</th>
            <th className="text-left py-1 border-b border-border font-normal pl-3">CYCLE</th>
            <th className="text-right py-1 border-b border-border font-normal pl-3">MONTHLY ({user.base_currency})</th>
            <th className="text-right py-1 border-b border-border font-normal pl-3">NEXT</th>
            <th className="text-right py-1 border-b border-border font-normal pl-3 w-20">ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {enriched.length === 0 && (
            <tr>
              <td colSpan={6} className="text-muted text-center py-4 italic">
                no subscriptions yet — add above
              </td>
            </tr>
          )}
          {enriched.map((r) => <SubRow key={r.id} s={r} base={user.base_currency} />)}
        </tbody>
      </table>
    </Panel>
  );
}
