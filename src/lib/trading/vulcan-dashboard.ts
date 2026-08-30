import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { vulcan_positions, vulcan_scores } from "@/db/schema";
import { getPrice } from "@/lib/market";

export type VulcanHoldingRow = {
  symbol: string;
  qty: number;
  entryPrice: number;
  entryDate: string;
  currentPrice: number | null;
  value: number | null;
  pnl: number | null;
  pnlPct: number | null;
};

export type VulcanCandidateRow = {
  symbol: string;
  sector: string;
  compositeScore: number;
  compositeRank: number | null;
  stage2Eligible: boolean;
  held: boolean;
};

export type VulcanDashboardData = {
  holdings: VulcanHoldingRow[];
  totalValue: number;
  totalPnl: number;
  latestRunDate: string | null;
  candidates: VulcanCandidateRow[];
};

export async function getVulcanDashboardData(userId: string): Promise<VulcanDashboardData> {
  const openRows = await db
    .select()
    .from(vulcan_positions)
    .where(and(eq(vulcan_positions.user_id, userId), eq(vulcan_positions.still_open, true)));

  const prices = await Promise.all(
    openRows.map((r) => getPrice(r.symbol, "equity").then((d) => d?.price ?? null).catch(() => null)),
  );

  const holdings: VulcanHoldingRow[] = openRows.map((r, i) => {
    const qty = parseFloat(r.qty);
    const entryPrice = parseFloat(r.entry_price);
    const currentPrice = prices[i];
    const value = currentPrice != null ? qty * currentPrice : null;
    const cost = qty * entryPrice;
    const pnl = value != null ? value - cost : null;
    return {
      symbol: r.symbol,
      qty,
      entryPrice,
      entryDate: r.entry_date.toISOString(),
      currentPrice,
      value,
      pnl,
      pnlPct: pnl != null && cost > 0 ? (pnl / cost) * 100 : null,
    };
  });

  const totalValue = holdings.reduce((s, h) => s + (h.value ?? 0), 0);
  const totalPnl = holdings.reduce((s, h) => s + (h.pnl ?? 0), 0);

  const latestRow = await db.select({ d: sql<string | null>`max(${vulcan_scores.run_date})` }).from(vulcan_scores);
  const latestRunDate = latestRow[0]?.d ?? null;

  const heldSymbols = new Set(holdings.map((h) => h.symbol));
  let candidates: VulcanCandidateRow[] = [];
  if (latestRunDate) {
    const rows = await db
      .select()
      .from(vulcan_scores)
      .where(eq(vulcan_scores.run_date, latestRunDate))
      .orderBy(desc(vulcan_scores.composite_score));
    candidates = rows.map((r) => ({
      symbol: r.symbol,
      sector: r.sector,
      compositeScore: parseFloat(r.composite_score),
      compositeRank: r.composite_rank,
      stage2Eligible: r.stage2_eligible,
      held: heldSymbols.has(r.symbol),
    }));
  }

  return { holdings, totalValue, totalPnl, latestRunDate, candidates };
}
