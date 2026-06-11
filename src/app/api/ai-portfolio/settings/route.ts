import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { ai_trading_settings } from "@/db/schema";
import { getOrCreateSettings } from "@/lib/trading/settings";

export const dynamic = "force-dynamic";

type Patch = {
  kill_switch?: boolean;
  monthly_cap_usd?: number;
  dca_amount_usd?: number;
  boost_amount_usd?: number;
  buy_zone_confidence?: number;
};

export async function POST(req: Request) {
  const user = await requireUser();
  await getOrCreateSettings(user.id);

  const body = (await req.json()) as Patch;
  const set: Record<string, unknown> = { updated_at: new Date() };

  if (typeof body.kill_switch === "boolean") set.kill_switch = body.kill_switch;
  if (Number.isFinite(body.monthly_cap_usd)) set.monthly_cap_usd = Number(body.monthly_cap_usd).toFixed(2);
  if (Number.isFinite(body.dca_amount_usd)) set.dca_amount_usd = Number(body.dca_amount_usd).toFixed(2);
  if (Number.isFinite(body.boost_amount_usd)) set.boost_amount_usd = Number(body.boost_amount_usd).toFixed(2);
  if (Number.isFinite(body.buy_zone_confidence)) {
    set.buy_zone_confidence = Math.max(0, Math.min(100, Math.round(body.buy_zone_confidence!)));
  }

  const updated = await db
    .update(ai_trading_settings)
    .set(set)
    .where(eq(ai_trading_settings.user_id, user.id))
    .returning();

  return Response.json({ ok: true, settings: updated[0] });
}
