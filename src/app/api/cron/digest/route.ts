import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_options_settings, ai_trading_settings } from "@/db/schema";
import { runScan, writeScanCache, writeHistory } from "@/lib/crypto/scanner";
import { manageOptionsPositionsForUser, runOptionsForUser } from "@/lib/options/engine";
import { buildPortfolioDigest } from "@/lib/trading/portfolio-digest";
import { sendTelegram } from "@/lib/telegram";

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
      out.scanner = { ok: true, universe: result.universe, passed: result.passed, kept: result.coins.length };
    }
  } catch (err) {
    out.scanner = { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }

  // ── Options wheel (Mondays only, UTC) ────────────────────────────────────
  const utcDay = new Date().getUTCDay();
  const forceWednesday = new URL(req.url).searchParams.has("force_wednesday");
  const isMonday = utcDay === 1;
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

  // ── Options position management (daily) ──────────────────────────────────
  // Profit-takes / rolls short legs, rolls aging LEAPS. No council calls — cheap.
  // Per-position-per-day idempotency, so a Monday double-fire is harmless.
  try {
    const armed = await db
      .select({ user_id: ai_options_settings.user_id })
      .from(ai_options_settings)
      .where(eq(ai_options_settings.kill_switch, false));
    const results: Record<string, unknown> = {};
    for (const { user_id } of armed) {
      try {
        const actions = await manageOptionsPositionsForUser(user_id);
        if (actions.length > 0) results[user_id] = actions;
      } catch (err) {
        results[user_id] = { error: err instanceof Error ? err.message : "unknown" };
      }
    }
    out.options_manage = { ran: true, processed: armed.length, results };
  } catch (err) {
    out.options_manage = { ran: false, error: err instanceof Error ? err.message : "unknown" };
  }

  // ── Portfolio digest (Wednesdays only, UTC) ──────────────────────────────
  const isWednesday = utcDay === 3 || forceWednesday;
  if (isWednesday) {
    try {
      const users = await db
        .select({ user_id: ai_trading_settings.user_id })
        .from(ai_trading_settings);
      for (const { user_id } of users) {
        const msg = await buildPortfolioDigest(user_id);
        if (msg) await sendTelegram(msg);
      }
      out.portfolio_digest = { ran: true, users: users.length };
    } catch (err) {
      out.portfolio_digest = { ran: false, error: err instanceof Error ? err.message : "unknown" };
    }
  } else {
    out.portfolio_digest = { ran: false, reason: "not Wednesday (UTC)" };
  }

  return Response.json({ ok: true, ...out });
}
