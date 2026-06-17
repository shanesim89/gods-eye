import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_options_settings } from "@/db/schema";
import { runScan, writeScanCache, writeHistory, getYesterdaySnapshot } from "@/lib/crypto/scanner";
import { runScannerAlerts } from "@/lib/crypto/scanner-alerts";
import { runOptionsForUser } from "@/lib/options/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Merged daily cron (scanner + weekly options) so the project stays within the
// Hobby 2-cron limit while keeping the real-money DCA cron on its own dedicated
// budget. Runs the moonshot scanner every day; runs the options wheel only on
// Mondays (UTC) to preserve its weekly cadence. Options engine has per-week
// idempotency, so a Monday-only gate plus that guard prevents any double-run.
// Secured by CRON_SECRET (Vercel Cron sends it as Authorization: Bearer).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const out: Record<string, unknown> = {};

  // ── Scanner (daily) ──────────────────────────────────────────────────────
  try {
    const result = await runScan();
    if (result.coins.length === 0) {
      out.scanner = { ok: false, error: "scan returned no coins (CoinGecko outage or rate limit)" };
    } else {
      await writeScanCache(result);
      await writeHistory(result);
      const yesterday = await getYesterdaySnapshot();
      const alerts = await runScannerAlerts(result, yesterday);
      out.scanner = { ok: true, universe: result.universe, passed: result.passed, kept: result.coins.length, alerts };
    }
  } catch (err) {
    out.scanner = { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }

  // ── Options wheel (Mondays only, UTC) ────────────────────────────────────
  const isMonday = new Date().getUTCDay() === 1;
  if (isMonday) {
    try {
      const armed = await db
        .select({ user_id: ai_options_settings.user_id })
        .from(ai_options_settings)
        .where(eq(ai_options_settings.kill_switch, false));
      const results: Record<string, unknown> = {};
      for (const { user_id } of armed) {
        try {
          results[user_id] = await runOptionsForUser(user_id);
        } catch (err) {
          results[user_id] = { ran: false, error: err instanceof Error ? err.message : "unknown" };
        }
      }
      out.options = { ran: true, processed: armed.length, results };
    } catch (err) {
      out.options = { ran: false, error: err instanceof Error ? err.message : "unknown" };
    }
  } else {
    out.options = { ran: false, reason: "not Monday (UTC)" };
  }

  return Response.json({ ok: true, ...out });
}
