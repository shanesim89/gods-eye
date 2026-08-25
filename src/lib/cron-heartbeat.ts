import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";

/**
 * Stamps a Neon heartbeat so the VPS watchdog (quant-scrap/infra_heartbeat.py,
 * NEON_FEEDS) can distinguish "this cron ran" from "this cron is dead".
 *
 * Row freshness on the bots' own output tables can't answer that: DCA only
 * writes ai_trade_orders on a real buy (14-day per-token cadence) and the
 * options engine only writes on an open/settle, so a healthy-but-idle run looks
 * identical to a cron that stopped firing. This key is written on every run
 * regardless of whether anything actually traded.
 *
 * Never throws — a monitoring write must not be able to fail the cron it
 * monitors. A missed stamp just surfaces as staleness, which is the safe
 * direction to fail in.
 */
export async function stampCronHeartbeat(
  key: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const payload = { ran_at: new Date().toISOString(), ...detail };
    await db
      .insert(market_data_cache)
      .values({ ticker: key, payload, fetched_at: new Date() })
      .onConflictDoUpdate({
        target: market_data_cache.ticker,
        set: { payload, fetched_at: new Date() },
      });
  } catch (err) {
    console.error(
      `[cron-heartbeat] ${key} failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}
