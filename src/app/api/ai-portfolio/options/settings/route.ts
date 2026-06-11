import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { ai_options_settings } from "@/db/schema";
import { getOrCreateOptionsSettings } from "@/lib/options/settings";

export const dynamic = "force-dynamic";

type Patch = {
  kill_switch?: boolean;
};

export async function POST(req: Request) {
  const user = await requireUser();
  await getOrCreateOptionsSettings(user.id);

  const body = (await req.json()) as Patch;
  const set: Record<string, unknown> = { updated_at: new Date() };

  if (typeof body.kill_switch === "boolean") set.kill_switch = body.kill_switch;

  const updated = await db
    .update(ai_options_settings)
    .set(set)
    .where(eq(ai_options_settings.user_id, user.id))
    .returning();

  return Response.json({ ok: true, settings: updated[0] });
}
