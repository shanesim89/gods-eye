import { eq } from "drizzle-orm";
import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { MCScalpEqLive } from "./MCScalpEqLive";
import type { MCScalpEqState } from "./types";

export const dynamic = "force-dynamic";

const STATE_KEY = "mcscalp_eq:live:state";

const FALLBACK: MCScalpEqState = {
  bot: "mcscalp_eq_tsmom",
  mode: "paper",
  equity: 10000,
  weights: {},
  targets_usd: {},
  positions_usd: {},
  allocator: null,
  trades_today: [],
  universe: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "AMD", "NFLX", "CRM"],
  lookback_days: 0,
  target_vol: 0,
  cycle_utc: null,
};

export default async function MCScalpEqPage() {
  await requireUser();
  let state: MCScalpEqState = FALLBACK;
  try {
    const rows = await db.select().from(market_data_cache).where(eq(market_data_cache.ticker, STATE_KEY)).limit(1);
    if (rows.length > 0 && rows[0].payload) {
      state = { ...FALLBACK, ...(rows[0].payload as MCScalpEqState) };
    }
  } catch {
    // keep fallback
  }
  return (
    <Panel title="AI PORTFOLIO · MCSCALP EQUITY" meta="PAPER · TSMOM ON 10 US EQUITIES">
      <MCScalpEqLive initial={state} />
    </Panel>
  );
}
