import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_trading_settings } from "@/db/schema";
import { runDcaForUser } from "@/lib/trading/engine";

export const dynamic = "force-dynamic";
// Hobby caps function duration at 60s. 4 tokens × full council (sequential LLM calls)
// can exceed this → the run is killed mid-loop, leaving tokens unprocessed (H4).
// Mitigated by per-token idempotency (next run resumes the unprocessed tokens), but
// for reliable single-pass runs upgrade to Pro and raise this to 300.
export const maxDuration = 60;

// Daily tick. Per-token 14-day cadence enforced in DB (ai_token_schedule).
// Secured by CRON_SECRET (Vercel Cron sends it as Authorization: Bearer).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  // Only users who have explicitly armed (kill_switch = false).
  const armed = await db
    .select({ user_id: ai_trading_settings.user_id })
    .from(ai_trading_settings)
    .where(eq(ai_trading_settings.kill_switch, false));

  const results: Record<string, unknown> = {};
  for (const { user_id } of armed) {
    try {
      results[user_id] = await runDcaForUser(user_id);
    } catch (err) {
      results[user_id] = { ran: false, error: err instanceof Error ? err.message : "unknown" };
    }
  }

  return Response.json({ ok: true, processed: armed.length, results });
}
