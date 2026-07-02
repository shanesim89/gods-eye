import { eq } from "drizzle-orm";
import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { QuantLive } from "./QuantLive";
import type { QuantState } from "./types";

export const dynamic = "force-dynamic";

const STATE_KEY = "quant:scrap:state";

const FALLBACK: QuantState = {
  stage: "PAPER FORWARD",
  version: "v4",
  strategy:
    "Multi-sleeve risk-parity ensemble: TSMOM++ · XSMOM · Carry · MeanRev. " +
    "GARCH vol targeting, fractional-Kelly leverage, drawdown de-lever, 3-loss adaptive circuit breaker.",
  equity: 10000,
  starting_balance: 10000,
  last_run: null,
  history: [],
  gates: {
    research: "PASS 2026-06-14 — H5: 5 combos OOS Sharpe>1",
    backtest_v3: "PASS 2026-06-13 — OOS Sharpe 1.66, DD 6.9%",
    backtest_v4: "PENDING — multi-sleeve combined backtest",
    paper: "AWAITING FIRST PUBLISH",
    live: "LOCKED — needs v4 backtest + 4wk paper + gate review",
  },
  backtest_stats: {
    oos_sharpe: 1.66,
    oos_ann_pct: 14.1,
    oos_dd_pct: 6.9,
    full_years: 8.8,
    full_sharpe: 1.53,
    note: "v3 single-sleeve; v4 multi-sleeve backtest pending",
  },
};

export default async function QuantScrapPage() {
  await requireUser();

  let state: QuantState = FALLBACK;
  try {
    const rows = await db
      .select()
      .from(market_data_cache)
      .where(eq(market_data_cache.ticker, STATE_KEY))
      .limit(1);
    if (rows.length > 0 && rows[0].payload) {
      state = { ...FALLBACK, ...(rows[0].payload as QuantState) };
    }
  } catch {
    // keep fallback
  }

  return (
    <Panel
      title="QUANT SCALPER"
      meta={`MULTI-SLEEVE RISK-PARITY ENSEMBLE · ${state.version ?? "v4"}`}
    >
      <QuantLive initial={state} />
    </Panel>
  );
}
