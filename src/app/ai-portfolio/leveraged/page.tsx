import { eq } from "drizzle-orm";
import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { LeveragedLive } from "./LeveragedLive";
import type { LeveragedState } from "./types";

export const dynamic = "force-dynamic";

const STATE_KEY = "leveraged-nasdaq";
const EMPTY_STATS = {
  trades: 0, win_rate: 0, profit_factor: 0, expectancy_r: 0,
  sharpe_ann: 0, max_dd_pct: 0, total_return_pct: 0, avg_hold_min: 0, clamped_pct: 0,
};

const FALLBACK: LeveragedState = {
  strategy: "Nasdaq 3x intraday momentum — long TQQQ on up-bias, long SQQQ on down-bias, hard EOD flatten",
  equity: 0,
  validated: false,
  active_params: {
    ema_fast: 9, ema_slow: 21, breakout_lookback_min: 30, atr_len: 14,
    stop_atr_mult: 1.5, tp1_atr_mult: 1.5, tp1_frac: 0.5, max_hold_min: 30,
    breakeven_after_tp1: true, entry_cutoff_min: 30, eod_flatten_min: 10,
  },
  backtest_stats: EMPTY_STATS,
  session: EMPTY_STATS,
  open_position: {},
  pending: [],
  skips: [],
  actions: [],
  last_run: null,
};

export default async function LeveragedPage() {
  await requireUser();

  let state: LeveragedState = FALLBACK;
  try {
    const rows = await db
      .select()
      .from(market_data_cache)
      .where(eq(market_data_cache.ticker, STATE_KEY))
      .limit(1);
    if (rows.length > 0 && rows[0].payload) {
      state = { ...FALLBACK, ...(rows[0].payload as LeveragedState) };
    }
  } catch {
    // keep fallback
  }

  return (
    <Panel
      title="LEVERAGED TQQQ/SQQQ"
      meta="PAPER · NASDAQ 3× INTRADAY MOMENTUM · NO_TRADE"
    >
      <LeveragedLive initial={state} />
    </Panel>
  );
}
