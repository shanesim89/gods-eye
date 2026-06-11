import { and, desc, eq, sql } from "drizzle-orm";
import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import {
  ai_options_positions,
  ai_options_wheel,
  council_verdict_cache,
} from "@/db/schema";
import { getOrCreateOptionsSettings } from "@/lib/options/settings";
import { getPrice } from "@/lib/market";
import type { Verdict } from "@/lib/council/types";
import { OptionsKillSwitch } from "./OptionsKillSwitch";
import { OptionCard, type OptionCardRow, type OpenPosition } from "./OptionCard";
import { OptionsStrategyThesis, type UnderlyingThesis } from "./OptionsStrategyThesis";
import { PortfolioSummary, type AllocSlice } from "../crypto/PortfolioSummary";
import type { Underlying } from "@/lib/options/settings";

export const dynamic = "force-dynamic";

function usd(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function dte(expiry: Date, now = new Date()): number {
  return Math.max(0, Math.round((expiry.getTime() - now.getTime()) / 86_400_000));
}

export default async function OptionsPage() {
  const user = await requireUser();
  const settings = await getOrCreateOptionsSettings(user.id);

  const underlyings = (settings.underlyings as Underlying[]) ?? [];

  // Wheel states
  const wheelRows = await db
    .select()
    .from(ai_options_wheel)
    .where(eq(ai_options_wheel.user_id, user.id));
  const wheelByUnderlying = new Map(wheelRows.map((r) => [r.underlying, r]));

  // Open positions
  const openPos = await db
    .select()
    .from(ai_options_positions)
    .where(and(eq(ai_options_positions.user_id, user.id), eq(ai_options_positions.status, "open")))
    .orderBy(desc(ai_options_positions.opened_at));

  // Settled positions: sum realized_pnl + premium income per underlying
  const settledAgg = await db
    .select({
      underlying: ai_options_positions.underlying,
      totalPnl: sql<string>`coalesce(sum(${ai_options_positions.realized_pnl}), 0)`,
    })
    .from(ai_options_positions)
    .where(
      and(
        eq(ai_options_positions.user_id, user.id),
        sql`${ai_options_positions.status} != 'open'`
      )
    )
    .groupBy(ai_options_positions.underlying);
  const settledByUnderlying = new Map(settledAgg.map((r) => [r.underlying, parseFloat(r.totalPnl)]));

  const now = new Date();

  const rows = await Promise.all(
    underlyings.map(async (und): Promise<OptionCardRow> => {
      const { symbol, class: assetClass } = und;

      const [priceData, verdictRow] = await Promise.all([
        getPrice(symbol, assetClass).catch(() => null),
        db
          .select()
          .from(council_verdict_cache)
          .where(
            and(
              eq(council_verdict_cache.user_id, user.id),
              eq(council_verdict_cache.ticker, symbol),
              eq(council_verdict_cache.asset_class, assetClass === "equity" ? "stocks" : assetClass)
            )
          )
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

      const positions: OpenPosition[] = myOpen.map((p) => {
        const greeks = (p.greeks as Record<string, number> | null) ?? {};
        return {
          id: p.id,
          strategy: p.strategy,
          contractSymbol: p.contract_symbol,
          strike: parseFloat(p.strike),
          expiry: p.expiry,
          dte: dte(p.expiry, now),
          optType: p.opt_type as "C" | "P",
          entryPremium: parseFloat(p.entry_premium),
          // Total premium = per-unit × stored multiplier × contracts (NOT a flat ×100;
          // crypto multipliers are ≈0.008, so ×100 overstated premium ~100×).
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
      // Premium income = sum of all short premiums collected (side=short, settled worthless or assigned/called)
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
        nextRun: wheel?.next_run_at ?? null,
        openPositions: positions,
        totalPremiumIncome: premiumIncome,
        totalRealizedPnl,
        collateralReserved,
      };
    })
  );

  // Portfolio summary
  const totalCollateral = rows.reduce((s, r) => s + r.collateralReserved, 0);
  const totalPnl = rows.reduce((s, r) => s + r.totalRealizedPnl, 0);
  const maxCollateral = parseFloat(settings.max_collateral_usd);
  const collateralPct = maxCollateral > 0 ? Math.min(100, (totalCollateral / maxCollateral) * 100) : 0;

  const alloc: AllocSlice[] = rows.map((r) => ({
    token: r.underlying,
    value: r.collateralReserved,
    pct: totalCollateral > 0 ? r.collateralReserved / totalCollateral : 0,
  }));

  const thesisUnderlyings: UnderlyingThesis[] = rows.map((r) => ({
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

  return (
    <Panel title="AI PORTFOLIO · OPTIONS" meta="PAPER · THE WHEEL + COUNCIL LONG PLAYS">
      {/* PAPER banner */}
      <div style={{ background: "rgba(255,207,74,.06)", border: "1px solid rgba(255,207,74,.35)", padding: "10px 14px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ fontSize: 14, color: "#ffcf4a", flexShrink: 0 }}>⚠</span>
        <div style={{ fontSize: 10, color: "#ffcf4a", lineHeight: 1.6 }}>
          <strong>PAPER TRADING — SIMULATED ONLY.</strong> No real money is moved. Premiums, strikes, and P&amp;L are calculated using Black-Scholes from live spot prices. Use this to learn and validate the strategy before connecting a real broker.
        </div>
      </div>

      {/* OPTIONS 101 explainer */}
      <details style={{ marginBottom: 16, border: "1px solid rgba(64,200,224,.15)", background: "rgba(70,224,245,.02)" }}>
        <summary style={{ padding: "8px 14px", fontSize: 9, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", cursor: "pointer", userSelect: "none" }}>
          OPTIONS 101 — THE WHEEL STRATEGY ▸
        </summary>
        <div style={{ padding: "10px 14px 14px", fontSize: 10, color: "#bfe9f2", lineHeight: 1.8, borderTop: "1px solid rgba(64,200,224,.1)" }}>
          <p style={{ marginBottom: 8 }}><strong style={{ color: "#ffcf4a" }}>What is an option?</strong> A contract giving the right (not obligation) to buy or sell an asset at a fixed price (strike) before a date (expiry). You pay a small premium for that right.</p>
          <p style={{ marginBottom: 8 }}><strong style={{ color: "#ffcf4a" }}>The Wheel (income strategy):</strong></p>
          <ol style={{ paddingLeft: 18, marginBottom: 8 }}>
            <li style={{ marginBottom: 4 }}><strong>Sell a cash-secured put (CSP)</strong> — Collect premium. If the stock stays above your strike at expiry, the put expires worthless and you keep the premium. Repeat.</li>
            <li style={{ marginBottom: 4 }}><strong>If assigned</strong> — Stock fell below strike; you buy 100 shares at your pre-agreed price. Your effective cost is strike minus the premium you already collected.</li>
            <li style={{ marginBottom: 4 }}><strong>Sell covered calls (CC)</strong> — Now holding shares, sell a call above your cost basis. Collect more premium. If stock rises above strike, shares are sold at a profit. Back to cash. Repeat.</li>
          </ol>
          <p style={{ marginBottom: 8 }}><strong style={{ color: "#27f59b" }}>Risk profile:</strong> Defined. Worst case = owning a stock you pre-approved at a price you set. No uncapped loss. Never sell naked.</p>
          <p><strong style={{ color: "#ffcf4a" }}>Council long plays:</strong> When council conviction is very high (BUY → long call, SELL → long put), a small directional bet is added. Budget-capped. Max loss = premium paid.</p>
        </div>
      </details>

      {/* control bar */}
      <div className="flex flex-wrap items-center gap-4 mb-4 border border-border bg-grid p-3">
        <div className="flex items-center gap-2">
          <span className="text-muted text-[10px] uppercase tracking-[1px]">STATUS</span>
          <OptionsKillSwitch initialKillSwitch={settings.kill_switch} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex justify-between text-[10px] uppercase tracking-[1px] mb-1">
            <span className="text-muted">COLLATERAL USED</span>
            <span className="text-amber tabular-nums">{usd(totalCollateral, 0)} / {usd(maxCollateral, 0)}</span>
          </div>
          <div className="h-1.5 bg-black border border-border">
            <div className={`h-full ${collateralPct >= 100 ? "bg-red" : "bg-amber"}`} style={{ width: `${collateralPct}%` }} />
          </div>
        </div>
        <div className="text-[10px] text-dim uppercase tracking-[1px]">
          Δ TARGET {settings.target_delta}% · DTE {settings.dte_min}–{settings.dte_max} · CADENCE 7D · CONVICTION {settings.conviction_threshold}%
        </div>
        <div className="text-[10px] tabular-nums">
          <span className="text-muted uppercase tracking-[1px] mr-2">TOTAL P&amp;L</span>
          <span className={totalPnl >= 0 ? "text-green" : "text-red"}>{usd(totalPnl, 0)}</span>
        </div>
      </div>

      {settings.last_alert && (
        <div className="border border-red/60 bg-red/5 text-red px-3 py-1.5 mb-4 text-[10px] tracking-[0.5px]">
          ⚠ {settings.last_alert}
        </div>
      )}

      <OptionsStrategyThesis
        convictionThreshold={settings.conviction_threshold}
        targetDelta={settings.target_delta}
        dteMin={settings.dte_min}
        dteMax={settings.dte_max}
        longPlayBudget={parseFloat(settings.long_play_budget_usd)}
        longPlayEnabled={settings.long_play_enabled}
        collateralPerContract={parseFloat(settings.collateral_per_contract_usd)}
        maxCollateral={maxCollateral}
        underlyings={thesisUnderlyings}
      />

      <PortfolioSummary
        totalValue={totalCollateral}
        totalCost={totalCollateral}
        totalPnl={totalPnl > 0 ? totalPnl : null}
        totalPnlPct={null}
        alloc={alloc}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        {rows.map((row) => (
          <OptionCard key={row.underlying} row={row} />
        ))}
      </div>
    </Panel>
  );
}
