import { Panel } from "@/components/ui/Panel";
import { db } from "@/db/client";
import { liabilities, assets } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { convert } from "@/lib/fx";
import { fmtMoney } from "@/lib/format";
import { AddForm } from "./AddForm";
import { LiaRow } from "./Row";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const base = user.base_currency;
  const [liaRows, assetRows] = await Promise.all([
    db.select().from(liabilities).where(eq(liabilities.user_id, user.id)).orderBy(asc(liabilities.name)),
    db.select().from(assets).where(eq(assets.user_id, user.id)).orderBy(asc(assets.name)),
  ]);

  // asset by id for join + value lookup
  const assetById: Record<string, typeof assetRows[number]> = {};
  for (const a of assetRows) assetById[a.id] = a;

  const enriched = await Promise.all(
    liaRows.map(async (r) => {
      const balBase = await convert(Number(r.balance), r.currency, base);
      let linkedAssetName: string | null = null;
      let linkedAssetValueBase: number | null = null;
      if (r.linked_asset_id && assetById[r.linked_asset_id]) {
        const la = assetById[r.linked_asset_id];
        linkedAssetName = la.name;
        const lcv = la.current_value !== null ? Number(la.current_value) : Number(la.cost_basis ?? 0);
        linkedAssetValueBase = await convert(lcv, la.currency, base);
      }
      return { ...r, balBase, linkedAssetName, linkedAssetValueBase };
    })
  );
  const totalBase = enriched.reduce((s, r) => s + r.balBase, 0);
  const assetOpts = assetRows.map((a) => ({ id: a.id, name: a.name ?? "untitled" }));

  return (
    <Panel
      title="LIABILITIES & LOANS"
      meta={`${liaRows.length} ITEMS · ${fmtMoney(totalBase, base, 0)} TOTAL`}
    >
      <AddForm assets={assetOpts} />
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse min-w-[900px]">
          <thead>
            <tr className="text-muted uppercase tracking-[0.5px]">
              <th className="text-left py-1 border-b border-border font-normal">NAME</th>
              <th className="text-right py-1 border-b border-border font-normal">BALANCE</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3">RATE</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3">MO PMT</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3">BAL ({base})</th>
              <th className="text-left py-1 border-b border-border font-normal pl-3">LINKED</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3">EQUITY ({base})</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3 w-20">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {enriched.length === 0 && (
              <tr><td colSpan={8} className="text-muted text-center py-4 italic">no liabilities</td></tr>
            )}
            {enriched.map((r) => <LiaRow key={r.id} l={r as Parameters<typeof LiaRow>[0]["l"]} base={base} assetOpts={assetOpts} />)}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
