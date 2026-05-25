import { Panel } from "@/components/ui/Panel";
import { db } from "@/db/client";
import { assets } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { convert } from "@/lib/fx";
import { fmtMoney } from "@/lib/format";
import { AddForm } from "./AddForm";
import { DeleteBtn } from "./DeleteBtn";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(assets)
    .where(eq(assets.user_id, user.id))
    .orderBy(asc(assets.asset_class), asc(assets.name));

  // Convert cost_basis to base currency (positions valuation = Phase 2 with live prices)
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const cb = Number(r.cost_basis ?? 0);
      const cbBase = await convert(cb, r.currency, user.base_currency);
      return { ...r, cbBase };
    })
  );

  const totalCost = enriched.reduce((sum, r) => sum + r.cbBase, 0);
  const byClass = enriched.reduce<Record<string, number>>((acc, r) => {
    acc[r.asset_class] = (acc[r.asset_class] ?? 0) + r.cbBase;
    return acc;
  }, {});

  return (
    <Panel
      title="ASSETS"
      meta={`${rows.length} POSITIONS · COST ${fmtMoney(
        totalCost,
        user.base_currency,
        0
      )}`}
    >
      <AddForm />

      {Object.keys(byClass).length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3 text-[10px]">
          {Object.entries(byClass).map(([cls, v]) => (
            <span
              key={cls}
              className="border border-border bg-grid px-2 py-0.5 text-muted uppercase"
            >
              {cls}:{" "}
              <span className="text-amber">
                {fmtMoney(v, user.base_currency, 0)}
              </span>
            </span>
          ))}
        </div>
      )}

      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-muted uppercase tracking-[0.5px]">
            <th className="text-left py-1 border-b border-border font-normal">
              NAME
            </th>
            <th className="text-left py-1 border-b border-border font-normal pl-3">
              TICKER
            </th>
            <th className="text-left py-1 border-b border-border font-normal pl-3">
              CLASS
            </th>
            <th className="text-right py-1 border-b border-border font-normal pl-3">
              QTY
            </th>
            <th className="text-right py-1 border-b border-border font-normal pl-3">
              COST
            </th>
            <th className="text-right py-1 border-b border-border font-normal pl-3">
              COST ({user.base_currency})
            </th>
            <th className="text-right py-1 border-b border-border font-normal pl-3 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {enriched.length === 0 && (
            <tr>
              <td colSpan={7} className="text-muted text-center py-4 italic">
                no assets yet — add above
              </td>
            </tr>
          )}
          {enriched.map((r) => (
            <tr key={r.id} className="dotted-row">
              <td className="py-1 text-text">{r.name}</td>
              <td className="py-1 pl-3 text-cyan">{r.ticker ?? "—"}</td>
              <td className="py-1 pl-3 text-muted uppercase">{r.asset_class}</td>
              <td className="py-1 pl-3 text-right">{r.qty}</td>
              <td className="py-1 pl-3 text-right">
                {fmtMoney(Number(r.cost_basis ?? 0), r.currency, 2)}
              </td>
              <td className="py-1 pl-3 text-right text-amber">
                {fmtMoney(r.cbBase, user.base_currency, 2)}
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
