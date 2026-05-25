import { Panel } from "@/components/ui/Panel";
import { db } from "@/db/client";
import { liabilities } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { convert } from "@/lib/fx";
import { fmtMoney, fmtPct } from "@/lib/format";
import { AddForm } from "./AddForm";
import { DeleteBtn } from "./DeleteBtn";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const base = user.base_currency;
  const rows = await db
    .select()
    .from(liabilities)
    .where(eq(liabilities.user_id, user.id))
    .orderBy(asc(liabilities.name));

  const enriched = await Promise.all(
    rows.map(async (r) => {
      const balBase = await convert(Number(r.balance), r.currency, base);
      return { ...r, balBase };
    })
  );
  const totalBase = enriched.reduce((s, r) => s + r.balBase, 0);

  return (
    <Panel
      title="LIABILITIES & LOANS"
      meta={`${rows.length} ITEMS · ${fmtMoney(totalBase, base, 0)} TOTAL`}
    >
      <AddForm />
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-muted uppercase tracking-[0.5px]">
            <th className="text-left py-1 border-b border-border font-normal">NAME</th>
            <th className="text-right py-1 border-b border-border font-normal">BALANCE</th>
            <th className="text-right py-1 border-b border-border font-normal pl-3">RATE</th>
            <th className="text-right py-1 border-b border-border font-normal pl-3">BALANCE ({base})</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {enriched.length === 0 && (
            <tr><td colSpan={5} className="text-muted text-center py-4 italic">no liabilities</td></tr>
          )}
          {enriched.map((r) => (
            <tr key={r.id} className="dotted-row">
              <td className="py-1 text-text">{r.name}</td>
              <td className="py-1 text-right">{fmtMoney(Number(r.balance), r.currency, 2)}</td>
              <td className="py-1 pl-3 text-right text-muted">
                {r.interest_rate ? fmtPct(Number(r.interest_rate)) : "—"}
              </td>
              <td className="py-1 pl-3 text-right text-red">{fmtMoney(r.balBase, base, 2)}</td>
              <td className="py-1 pl-3 text-right"><DeleteBtn id={r.id} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
