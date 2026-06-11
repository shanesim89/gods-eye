import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_options_settings } from "@/db/schema";
import { runOptionsForUser } from "@/lib/options/engine";

export const dynamic = "force-dynamic";
// Hobby caps at 60s; council runs per underlying can exceed it (H4). Per-week
// idempotency lets a killed run resume next invocation. Raise to 300 on Pro.
export const maxDuration = 60;

// Weekly cron (Mon 14:00 UTC). Secured by CRON_SECRET.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const force = new URL(req.url).searchParams.get("force") === "1";

  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const armed = await db
    .select({ user_id: ai_options_settings.user_id })
    .from(ai_options_settings)
    .where(eq(ai_options_settings.kill_switch, false));

  const results: Record<string, unknown> = {};
  for (const { user_id } of armed) {
    try {
      results[user_id] = await runOptionsForUser(user_id, { force });
    } catch (err) {
      results[user_id] = { ran: false, error: err instanceof Error ? err.message : "unknown" };
    }
  }

  return Response.json({ ok: true, processed: armed.length, results });
}
