import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_options_settings, ai_trading_settings } from "@/db/schema";
import { runScan, writeScanCache, writeHistory } from "@/lib/crypto/scanner";
import { manageOptionsPositionsForUser, runOptionsForUser } from "@/lib/options/engine";
import { buildPortfolioDigest } from "@/lib/trading/portfolio-digest";
import { writeDailySnapshot } from "@/lib/trading/daily-snapshot";
import { deliverPortfolioDigests } from "@/lib/trading/telegram-delivery";
import { sendTelegram } from "@/lib/telegram";
import { stampCronHeartbeat } from "@/lib/cron-heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Merged daily cron (scanner + weekly options) so the project stays within the
// Hobby 2-cron limit while keeping the real-money DCA cron on its own dedicated
// budget. Runs the moonshot scanner every day; runs the options wheel only on
// Mondays (UTC) to preserve its weekly cadence. Options engine has per-week
// idempotency, so a Monday-only gate plus that guard prevents any double-run.
//
// Scheduled 14:00 UTC (vercel.json), not midnight — the options screener needs
// live Yahoo bid/ask/OI on the watchlist, which read as $0/0 outside US market
// hours (open 13:30 UTC). Verified 2026-07-06: every watchlist symbol's chain
// had bid=ask=OI=0 despite real volume when probed at ~01:00 UTC. 14:00 UTC
// gives the market 30min to populate quotes. This also nudges the Wednesday
// portfolio-digest Telegram send from ~9am to ~10pm SGT — accepted tradeoff
// to stay within the 2-cron Hobby limit (Shane confirmed).
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

  // ── Options wheel (weekdays, UTC) ────────────────────────────────────────
  // Per-week idempotency caps each underlying at ONE open per ISO week, so running
  // the open-path every trading day is safe: Monday is the intended entry, but
  // Tue–Fri act as automatic retries if Monday skipped on a transient failure
  // (off-hours $0 quotes, feed hiccup, council error). Before this was Monday-only,
  // a single bad Monday killed the strategy for the whole week (2026-07-06 incident).
  const utcDay = new Date().getUTCDay();
  const forceWednesday = new URL(req.url).searchParams.has("force_wednesday");
  const isTradingDay = utcDay >= 1 && utcDay <= 5;
  if (isTradingDay) {
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
    out.options = { ran: false, reason: "weekend (UTC)" };
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

  // ── Daily P/L snapshot (every day) ───────────────────────────────────────
  // Records yesterday's completed UTC day per bot into daily_pnl for the 30-day
  // calendar. Runs at 14:00 UTC, so "yesterday" is a fully settled 24h window.
  // Idempotent (PK upsert) — a double-fire just overwrites the same rows.
  try {
    const yesterday = new Date(Date.now() - 86_400_000);
    const users = await db
      .select({ user_id: ai_trading_settings.user_id })
      .from(ai_trading_settings);
    let written = 0;
    for (const { user_id } of users) {
      try {
        written += await writeDailySnapshot(user_id, yesterday);
      } catch (err) {
        console.error(`[cron] daily-snapshot ${user_id} failed:`, err instanceof Error ? err.message : err);
      }
    }
    out.daily_snapshot = { ran: true, users: users.length, rows: written };
  } catch (err) {
    out.daily_snapshot = { ran: false, error: err instanceof Error ? err.message : "unknown" };
  }

  // ── Portfolio digest (Wednesdays only, UTC) ──────────────────────────────
  const isWednesday = utcDay === 3 || forceWednesday;
  if (isWednesday) {
    try {
      const users = await db
        .select({ user_id: ai_trading_settings.user_id })
        .from(ai_trading_settings);
      out.portfolio_digest = await deliverPortfolioDigests(
        users,
        buildPortfolioDigest,
        sendTelegram,
      );
    } catch (err) {
      out.portfolio_digest = { ran: false, error: err instanceof Error ? err.message : "unknown" };
    }
  } else {
    out.portfolio_digest = { ran: false, reason: "not Wednesday (UTC)" };
  }

  // ── Watchdog heartbeat (always last) ─────────────────────────────────────
  // Every section above is individually try/caught, so we reach here even on a
  // partial failure — the stamp means "the cron fired", and the per-section
  // flags say what actually succeeded. Only a hard crash (or the cron never
  // firing) leaves this key stale, which is exactly what should alert.
  await stampCronHeartbeat("cron:digest:last_run", {
    scanner: (out.scanner as { ok?: boolean } | undefined)?.ok ?? false,
    options: (out.options as { ran?: boolean } | undefined)?.ran ?? false,
    options_manage: (out.options_manage as { ran?: boolean } | undefined)?.ran ?? false,
    daily_snapshot: (out.daily_snapshot as { ran?: boolean } | undefined)?.ran ?? false,
  });

  return Response.json({ ok: true, ...out });
}
