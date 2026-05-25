import { Panel } from "@/components/ui/Panel";
import { db } from "@/db/client";
import { subscriptions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { convert } from "@/lib/fx";
import { fmtMoney, daysUntil, toMonthly } from "@/lib/format";
import { AddForm } from "./AddForm";
import { DeleteBtn } from "./DeleteBtn";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.user_id, user.id))
    .orderBy(asc(subscriptions.next_charge));

  // Compute USD-monthly for each + total
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const amt = Number(r.amount);
      const monthlyNative = toMonthly(amt, r.cycle);
      const monthlyUsd = await convert(
        monthlyNative,
        r.currency,
        user.base_currency
      );
      return { ...r, monthlyNative, monthlyUsd };
    })
  );
  const totalMonthlyBase = enriched.reduce(
    (sum, r) => sum + r.monthlyUsd,
    0
  );

  return (
    <Panel
      title="SUBSCRIPTIONS"
      meta={`${rows.length} ACTIVE · ${fmtMoney(
        totalMonthlyBase,
        user.base_currency,
        0
      )}/MO`}
    >
      <AddForm />

      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-muted uppercase tracking-[0.5px]">
            <th className="text-left py-1 border-b border-border font-normal">
              SERVICE
            </th>
            <th className="text-right py-1 border-b border-border font-normal">
              AMOUNT
            </th>
            <th className="text-left py-1 border-b border-border font-normal pl-3">
              CYCLE
            </th>
            <th className="text-right py-1 border-b border-border font-normal pl-3">
              MONTHLY ({user.base_currency})
            </th>
            <th className="text-right py-1 border-b border-border font-normal pl-3">
              NEXT
            </th>
            <th className="text-right py-1 border-b border-border font-normal pl-3 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {enriched.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="text-muted text-center py-4 italic"
              >
                no subscriptions yet — add above
              </td>
            </tr>
          )}
          {enriched.map((r) => (
            <tr key={r.id} className="dotted-row">
              <td className="py-1 text-text">{r.name}</td>
              <td className="py-1 text-right">
                {fmtMoney(Number(r.amount), r.currency, 2)}
              </td>
              <td className="py-1 pl-3 text-muted uppercase">{r.cycle}</td>
              <td className="py-1 pl-3 text-right text-amber">
                {fmtMoney(r.monthlyUsd, user.base_currency, 2)}
              </td>
              <td className="py-1 pl-3 text-right text-cyan">
                {daysUntil(r.next_charge)}
              </td>
              <td className="py-1 pl-3 text-right">
                <DeleteBtn id={r.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
