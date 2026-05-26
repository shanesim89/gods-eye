import { Panel } from "@/components/ui/Panel";
import { db } from "@/db/client";
import { assets, liabilities } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { convert } from "@/lib/fx";
import { fmtMoney } from "@/lib/format";
import { AddForm } from "./AddForm";
import { AssetRow } from "./Row";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const base = user.base_currency;
  const [assetRows, liaRows] = await Promise.all([
    db.select().from(assets).where(eq(assets.user_id, user.id)).orderBy(asc(assets.asset_class), asc(assets.name)),
    db.select().from(liabilities).where(eq(liabilities.user_id, user.id)).orderBy(asc(liabilities.name)),
  ]);

  // Build linked liability lookup: asset_id -> liability
  const liaByAsset: Record<string, { id: string; name: string }> = {};
  for (const l of liaRows) {
    if (l.linked_asset_id) liaByAsset[l.linked_asset_id] = { id: l.id, name: l.name };
  }

  const enriched = await Promise.all(
    assetRows.map(async (r) => {
      const cb = Number(r.cost_basis ?? 0);
      const cv = r.current_value !== null ? Number(r.current_value) : null;
      const cbBase = await convert(cb, r.currency, base);
      const cvBase = cv !== null ? await convert(cv, r.currency, base) : 0;
      const link = liaByAsset[r.id] ?? null;
      return {
        ...r,
        cbBase,
        cvBase,
        linkedLiabilityId: link?.id ?? null,
        linkedLiabilityName: link?.name ?? null,
      };
    })
  );

  const totalCb = enriched.reduce((sum, r) => sum + r.cbBase, 0);
  const totalCv = enriched.reduce((sum, r) => sum + (r.cvBase || r.cbBase), 0);
  const byClass = enriched.reduce<Record<string, number>>((acc, r) => {
    acc[r.asset_class] = (acc[r.asset_class] ?? 0) + (r.cvBase || r.cbBase);
    return acc;
  }, {});

  const liabilityOpts = liaRows.map((l) => ({ id: l.id, name: l.name ?? "untitled" }));

  return (
    <Panel
      title="ASSETS"
      meta={`${assetRows.length} POSITIONS · MARKET ${fmtMoney(totalCv, base, 0)} · COST ${fmtMoney(totalCb, base, 0)}`}
    >
      <AddForm liabilities={liabilityOpts} />

      {Object.keys(byClass).length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3 text-[10px]">
          {Object.entries(byClass).map(([cls, v]) => (
            <span key={cls} className="border border-border bg-grid px-2 py-0.5 text-muted uppercase">
              {cls}: <span className="text-amber">{fmtMoney(v, base, 0)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse min-w-[900px]">
          <thead>
            <tr className="text-muted uppercase tracking-[0.5px]">
              <th className="text-left py-1 border-b border-border font-normal">NAME</th>
              <th className="text-left py-1 border-b border-border font-normal pl-3">TICKER</th>
              <th className="text-left py-1 border-b border-border font-normal pl-3">CLASS</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3">QTY</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3">COST</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3">MARKET</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3">VALUE ({base})</th>
              <th className="text-left py-1 border-b border-border font-normal pl-3">LINKED</th>
              <th className="text-right py-1 border-b border-border font-normal pl-3 w-20">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {enriched.length === 0 && (
              <tr><td colSpan={9} className="text-muted text-center py-4 italic">no assets yet — add above</td></tr>
            )}
            {enriched.map((r) => (
              <AssetRow key={r.id} a={r as Parameters<typeof AssetRow>[0]["a"]} base={base} liabilities={liabilityOpts} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
