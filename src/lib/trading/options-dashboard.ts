import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_options_positions, ai_options_wheel, ai_options_orders, council_verdict_cache } from "@/db/schema";
import { getOrCreateOptionsSettings } from "@/lib/options/settings";
import { getPrice, getPriceOHLC, type OhlcBar } from "@/lib/market";
import type { Verdict } from "@/lib/council/types";
import type { Underlying } from "@/lib/options/settings";
import type { OptionsOrderRow } from "@/app/ai-portfolio/options/OptionsOrderLog";

function dte(expiry: Date, now = new Date()): number {
  return Math.max(0, Math.round((expiry.getTime() - now.getTime()) / 86_400_000));
}

/** Wire-safe (JSON) versions — Date fields become ISO strings. */
export type WireOpenPosition = {
  id: string;
  strategy: string;
  contractSymbol: string;
  strike: number;
  expiry: string;
  dte: number;
  optType: "C" | "P";
  entryPremium: number;
  premiumTotal: number;
  delta: number | null;
  theta: number | null;
  side: string;
};

export type WireOptionCardRow = {
  underlying: string;
  assetClass: string;
  spot: number | null;
  changePct: number | null;
  verdict: Verdict | null;
  wheelState: "cash" | "holding_stock";
  shares: number;
  costBasis: number | null;
  nextRun: string | null;
  openPositions: WireOpenPosition[];
  totalPremiumIncome: number;
  totalRealizedPnl: number;
  collateralReserved: number;
  targetDelta: number;
  dteMin: number;
  dteMax: number;
};

export type WireUnderlyingThesis = {
  symbol: string;
  assetClass: string;
  spot: number | null;
  wheelState: "cash" | "holding_stock";
  shares: number;
  costBasis: number | null;
  verdict: string | null;
  confidence: number | null;
  nextRun: string | null;
  collateralReserved: number;
  openCount: number;
};

export type OptionsDashboardData = {
  killSwitch: boolean;
  lastAlert: string | null;
  targetDelta: number;
  dteMin: number;
  dteMax: number;
  convictionThreshold: number;
  longPlayBudget: number;
  longPlayEnabled: boolean;
  collateralPerContract: number;
  maxCollateral: number;
  totalCollateral: number;
  totalPnl: number;
  totalPremiumIncome: number;
  totalOpenCount: number;
  alloc: { symbol: string; value: number; pct: number }[];
  rows: WireOptionCardRow[];
  thesisUnderlyings: WireUnderlyingThesis[];
  orderLog: OptionsOrderRow[];
  candles: Record<string, OhlcBar[]>; // crypto underlyings only
};

export async function getOptionsDashboardData(userId: string): Promise<OptionsDashboardData> {
  const settings = await getOrCreateOptionsSettings(userId);
  const underlyings = (settings.underlyings as Underlying[]) ?? [];

  const wheelRows = await db.select().from(ai_options_wheel).where(eq(ai_options_wheel.user_id, userId));
  const wheelByUnderlying = new Map(wheelRows.map((r) => [r.underlying, r]));

  const openPos = await db
    .select()
    .from(ai_options_positions)
    .where(and(eq(ai_options_positions.user_id, userId), eq(ai_options_positions.status, "open")))
    .orderBy(desc(ai_options_positions.opened_at));

  const settledAgg = await db
    .select({
      underlying: ai_options_positions.underlying,
      totalPnl: sql<string>`coalesce(sum(${ai_options_positions.realized_pnl}), 0)`,
    })
    .from(ai_options_positions)
    .where(and(eq(ai_options_positions.user_id, userId), sql`${ai_options_positions.status} != 'open'`))
    .groupBy(ai_options_positions.underlying);
  const settledByUnderlying = new Map(settledAgg.map((r) => [r.underlying, parseFloat(r.totalPnl)]));

  const now = new Date();

  const rows = await Promise.all(
    underlyings.map(async (und): Promise<WireOptionCardRow> => {
      const { symbol, class: assetClass } = und;

      const [priceData, verdictRow] = await Promise.all([
        getPrice(symbol, assetClass).catch(() => null),
        db
          .select()
          .from(council_verdict_cache)
          .where(and(
            eq(council_verdict_cache.user_id, userId),
            eq(council_verdict_cache.ticker, symbol),
            eq(council_verdict_cache.asset_class, assetClass === "equity" ? "stocks" : assetClass)
          ))
          .orderBy(desc(council_verdict_cache.fetched_at))
          .limit(1)
          .then((r) => r[0] ?? null),
      ]);

      let verdict: Verdict | null = null;
      if (verdictRow) {
        const p = verdictRow.payload as Partial<Verdict>;
        verdict = {
          verdict: verdictRow.verdict as Verdict["verdict"],
          confidence: verdictRow.confidence ?? 50,
          summary: p.summary ?? "",
          agents: p.agents ?? [],
          generatedAt: verdictRow.fetched_at.toISOString(),
          tradeLevels: p.tradeLevels ?? null,
          currency: p.currency ?? "USD",
        };
      }

      const wheel = wheelByUnderlying.get(symbol);
      const myOpen = openPos.filter((p) => p.underlying === symbol);

      const positions: WireOpenPosition[] = myOpen.map((p) => {
        const greeks = (p.greeks as Record<string, number> | null) ?? {};
        return {
          id: p.id,
          strategy: p.strategy,
          contractSymbol: p.contract_symbol,
          strike: parseFloat(p.strike),
          expiry: p.expiry.toISOString(),
          dte: dte(p.expiry, now),
          optType: p.opt_type as "C" | "P",
          entryPremium: parseFloat(p.entry_premium),
          premiumTotal: parseFloat(p.entry_premium) * parseFloat(p.contract_multiplier) * p.contracts,
          delta: typeof greeks.delta === "number" ? greeks.delta : null,
          theta: typeof greeks.theta === "number" ? greeks.theta : null,
          side: p.side,
        };
      });

      const collateralReserved = myOpen
        .filter((p) => p.strategy === "csp")
        .reduce((s, p) => s + parseFloat(p.collateral_usd), 0);

      const totalRealizedPnl = settledByUnderlying.get(symbol) ?? 0;
      const premiumIncome = totalRealizedPnl > 0 ? totalRealizedPnl : 0;

      return {
        underlying: symbol,
        assetClass,
        spot: priceData?.price ?? null,
        changePct: priceData?.change_pct ?? null,
        verdict,
        wheelState: (wheel?.state ?? "cash") as "cash" | "holding_stock",
        shares: parseFloat(wheel?.shares ?? "0"),
        costBasis: wheel?.cost_basis ? parseFloat(wheel.cost_basis) : null,
        nextRun: wheel?.next_run_at ? wheel.next_run_at.toISOString() : null,
        openPositions: positions,
        totalPremiumIncome: premiumIncome,
        totalRealizedPnl,
        collateralReserved,
        targetDelta: settings.target_delta,
        dteMin: settings.dte_min,
        dteMax: settings.dte_max,
      };
    })
  );

  const totalCollateral = rows.reduce((s, r) => s + r.collateralReserved, 0);
  const totalPnl = rows.reduce((s, r) => s + r.totalRealizedPnl, 0);
  const maxCollateral = parseFloat(settings.max_collateral_usd);

  const openShortPremium = rows.reduce(
    (s, r) => s + r.openPositions.filter((p) => p.side === "short").reduce((x, p) => x + p.premiumTotal, 0),
    0
  );
  const totalPremiumIncome = rows.reduce((s, r) => s + r.totalPremiumIncome, 0) + openShortPremium;
  const totalOpenCount = rows.reduce((s, r) => s + r.openPositions.length, 0);

  const alloc = rows.map((r) => ({
    symbol: r.underlying,
    value: r.collateralReserved,
    pct: totalCollateral > 0 ? r.collateralReserved / totalCollateral : 0,
  }));

  const orderRows = await db
    .select()
    .from(ai_options_orders)
    .where(eq(ai_options_orders.user_id, userId))
    .orderBy(desc(ai_options_orders.created_at))
    .limit(100);
  const orderLog: OptionsOrderRow[] = orderRows.map((o) => ({
    id: o.id,
    underlying: o.underlying,
    action: o.action,
    date: o.created_at.toISOString(),
    detail: (o.detail as OptionsOrderRow["detail"]) ?? null,
  }));

  const thesisUnderlyings: WireUnderlyingThesis[] = rows.map((r) => ({
    symbol: r.underlying,
    assetClass: r.assetClass,
    spot: r.spot,
    wheelState: r.wheelState,
    shares: r.shares,
    costBasis: r.costBasis,
    verdict: r.verdict?.verdict ?? null,
    confidence: r.verdict?.confidence ?? null,
    nextRun: r.nextRun,
    collateralReserved: r.collateralReserved,
    openCount: r.openPositions.length,
  }));

  // Daily-ish OHLC for underlyings only where a free provider exists (crypto, via
  // CoinGecko). Equity/ETF underlyings (AAPL, SPY) get the Observing card without a
  // candlestick — Finnhub free tier is quote-only, no reliable OHLC history wired.
  const candles: Record<string, OhlcBar[]> = {};
  await Promise.all(
    underlyings
      .filter((u) => u.class === "crypto")
      .map(async (u) => {
        candles[u.symbol] = (await getPriceOHLC(u.symbol, 90).catch(() => null)) ?? [];
      })
  );

  return {
    killSwitch: settings.kill_switch,
    lastAlert: settings.last_alert,
    targetDelta: settings.target_delta,
    dteMin: settings.dte_min,
    dteMax: settings.dte_max,
    convictionThreshold: settings.conviction_threshold,
    longPlayBudget: parseFloat(settings.long_play_budget_usd),
    longPlayEnabled: settings.long_play_enabled,
    collateralPerContract: parseFloat(settings.collateral_per_contract_usd),
    maxCollateral,
    totalCollateral,
    totalPnl,
    totalPremiumIncome,
    totalOpenCount,
    alloc,
    rows,
    thesisUnderlyings,
    orderLog,
    candles,
  };
}
