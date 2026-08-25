import { eq } from "drizzle-orm";
import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { PDHLLive } from "../_components/PDHLLive";
import type { PDHLState } from "../_components/types";

export const dynamic = "force-dynamic";

const STATE_KEY = "gold:pdhl:state";

const FALLBACK: PDHLState = {
  stage: "PAPER FORWARD",
  version: "pdhl-v1",
  strategy:
    "XAUUSD PDH/PDL break+retest (long+short, 1m). Entry: confirmed close-break " +
    "of prev-day H/L, retest within 0.03% of level, close holds above/below. " +
    "Exit: scale-out — bank half at +1R, move stop to breakeven, run the rest to " +
    "2.0R / structure SL / 2h time stop. Session: London+NY (07–21 UTC). Paper-forward.",
  equity: 10000,
  starting_balance: 10000,
  circuit_state: "NORMAL",
  open_position: null,
  session: { trades: 0, win_rate: null, profit_factor: null, pnl: 0 },
  history: [],
  recent_trades: [],
  recent_bars: [],
  observing: {},
  last_run: null,
  gates: {
    research: "walk-forward pass (OOS Sharpe 5.0, DD 1.4%, perm_p 0.079)",
    paper: "AWAITING FIRST PUBLISH",
    live: "LOCKED — needs 4wk paper + gate review",
  },
};

export default async function PDHLScalperPage() {
  await requireUser();

  let state: PDHLState = FALLBACK;
  try {
    const rows = await db
      .select()
      .from(market_data_cache)
      .where(eq(market_data_cache.ticker, STATE_KEY))
      .limit(1);
    if (rows.length > 0 && rows[0].payload) {
      state = { ...FALLBACK, ...(rows[0].payload as PDHLState) };
    }
  } catch {
    // keep fallback
  }

  return (
    <Panel
      title="PDH/PDL SCALPER"
      meta={`PAPER · DAILY BREAK+RETEST · ${state.version ?? "pdhl-v1"}`}
    >
      <div className="border border-green/40 bg-green/5 px-3 py-2 mb-3 text-[11px]">
        <div className="text-green uppercase tracking-[1px]">● DAILY · PAPER ACTIVE</div>
        <div className="text-dim mt-1">Portfolio accounting enabled</div>
      </div>
      <PDHLLive initial={state} />
    </Panel>
  );
}
