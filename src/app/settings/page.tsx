import { Panel } from "@/components/ui/Panel";
import { Row, SectionLabel } from "@/components/ui/Row";
import { db } from "@/db/client";
import {
  assets,
  subscriptions,
  fixed_expenses,
  liabilities,
  income_sources,
  investment_commitments,
  fx_rates_cache,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function count(table: typeof assets, userId: string) {
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.user_id, userId));
  return r[0]?.c ?? 0;
}

export default async function Page() {
  const user = await requireUser();
  const [nAssets, nSubs, nFx, nLia, nInc, nIc, fxCacheRows] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(assets).where(eq(assets.user_id, user.id)).then((r) => r[0]?.c ?? 0),
    db.select({ c: sql<number>`count(*)::int` }).from(subscriptions).where(eq(subscriptions.user_id, user.id)).then((r) => r[0]?.c ?? 0),
    db.select({ c: sql<number>`count(*)::int` }).from(fixed_expenses).where(eq(fixed_expenses.user_id, user.id)).then((r) => r[0]?.c ?? 0),
    db.select({ c: sql<number>`count(*)::int` }).from(liabilities).where(eq(liabilities.user_id, user.id)).then((r) => r[0]?.c ?? 0),
    db.select({ c: sql<number>`count(*)::int` }).from(income_sources).where(eq(income_sources.user_id, user.id)).then((r) => r[0]?.c ?? 0),
    db.select({ c: sql<number>`count(*)::int` }).from(investment_commitments).where(eq(investment_commitments.user_id, user.id)).then((r) => r[0]?.c ?? 0),
    db.select({ c: sql<number>`count(*)::int` }).from(fx_rates_cache).then((r) => r[0]?.c ?? 0),
  ]);

  const total = nAssets + nSubs + nFx + nLia + nInc + nIc;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Panel title="ACCOUNT" meta="WHO YOU ARE">
        <Row k="User ID (internal)" v={user.id.slice(0, 8) + "…"} tone="muted" />
        <Row k="Clerk ID" v={user.clerk_id.slice(0, 12) + "…"} tone="muted" />
        <Row k="Email" v={user.email ?? "—"} />
        <Row k="Base Currency" v={user.base_currency} tone="amber" />
      </Panel>

      <Panel title="DATA INTEGRITY" meta={`${total} ROWS · NEON POSTGRES`}>
        <Row k="Assets" v={String(nAssets)} tone={nAssets > 0 ? "green" : "muted"} />
        <Row k="Liabilities" v={String(nLia)} tone={nLia > 0 ? "red" : "muted"} />
        <Row k="Subscriptions" v={String(nSubs)} tone={nSubs > 0 ? "amber" : "muted"} />
        <Row k="Fixed Expenses" v={String(nFx)} tone={nFx > 0 ? "red" : "muted"} />
        <Row k="Income Sources" v={String(nInc)} tone={nInc > 0 ? "green" : "muted"} />
        <Row k="DCA Commitments" v={String(nIc)} tone={nIc > 0 ? "cyan" : "muted"} />
        <SectionLabel>SYSTEM</SectionLabel>
        <Row k="FX rate cache" v={`${fxCacheRows} pairs (1hr TTL)`} tone="muted" />
        <Row k="Persistence" v="✓ Neon Postgres · ap-southeast-1" tone="green" />
        <Row k="Backup" v="auto by Neon (point-in-time recovery)" tone="muted" />
      </Panel>

      <Panel title="DATA SOURCES" meta="CONNECTED SERVICES">
        <Row k="FX Provider" v="exchangerate.host (free)" />
        <Row k="Market Data" v="Finnhub + Yahoo fallback" />
        <Row k="Crypto" v="CoinGecko (Phase 2)" tone="muted" />
        <Row k="News + Sentiment" v="Marketaux (Phase 3)" tone="muted" />
        <Row k="LLM Council" v="Claude Sonnet 4.6 (Phase 3)" tone="muted" />
      </Panel>

      <Panel title="EXPORT / BACKUP" meta="MANUAL">
        <div className="text-muted text-[11px]">
          Phase 4: JSON export endpoint. For now, raw access via Neon console:
        </div>
        <Row
          k="Console"
          v={
            <a href="https://console.neon.tech" target="_blank" rel="noreferrer" className="text-cyan hover:text-amber">
              console.neon.tech ▸
            </a>
          }
        />
      </Panel>
    </div>
  );
}
