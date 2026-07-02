import { eq } from "drizzle-orm";
import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { GoldLive } from "../_components/GoldLive";
import type { GoldState } from "../_components/types";

export const dynamic = "force-dynamic";

const STATE_KEY = "gold:scalper:state";

const FALLBACK: GoldState = {
  stage: "PAPER FORWARD",
  version: "gold-v1",
  strategy:
    "XAUUSD session-VWAP deep-stretch fade (long+short, 1m). Entry on |stretch|≥3σ " +
    "fresh crossing toward VWAP, gated by ranging-regime + London/NY session + " +
    "spread-room + (optional) Kronos/council. Risk = MC worst-case sizing + " +
    "daily/weekly caps + 3-loss circuit breaker. Nightly walk-forward self-tune.",
  equity: 10000,
  starting_balance: 10000,
  regime: "unknown",
  circuit_state: "NORMAL",
  lever: 1,
  open_position: null,
  session: { trades: 0, win_rate: null, profit_factor: null, pnl: 0 },
  active_params: {},
  history: [],
  recent_trades: [],
  recent_bars: [],
  observing: {},
  last_run: null,
  gates: {
    research: "pending optimizer OOS pass",
    paper: "AWAITING FIRST PUBLISH",
    live: "LOCKED — needs 4wk paper + gate review",
  },
};

export default async function GoldScalperPage() {
  await requireUser();

  let state: GoldState = FALLBACK;
  try {
    const rows = await db
      .select()
      .from(market_data_cache)
      .where(eq(market_data_cache.ticker, STATE_KEY))
      .limit(1);
    if (rows.length > 0 && rows[0].payload) {
      state = { ...FALLBACK, ...(rows[0].payload as GoldState) };
    }
  } catch {
    // keep fallback
  }

  return (
    <Panel title="GOLD PRINTING MACHINES" meta={`XAUUSD L/S SCALPER · ${state.version ?? "gold-v1"}`}>
      <GoldLive initial={state} />
    </Panel>
  );
}
