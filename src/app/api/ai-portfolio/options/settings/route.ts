import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { ai_options_settings } from "@/db/schema";
import { getOrCreateOptionsSettings, type Underlying } from "@/lib/options/settings";

export const dynamic = "force-dynamic";

type Patch = {
  kill_switch?: boolean;
  target_delta?: number;
  dte_min?: number;
  dte_max?: number;
  // Per-underlying config incl. mode:"wheel"|"pmcc" — lets the user flip a symbol to PMCC.
  underlyings?: Underlying[];
  pmcc_leaps_delta?: number;
  pmcc_leaps_dte_min?: number;
  pmcc_leaps_dte_max?: number;
  pmcc_budget_usd?: number;
};

function isUnderlying(u: unknown): u is Underlying {
  if (u == null || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  return (
    typeof o.symbol === "string" &&
    (o.class === "equity" || o.class === "etf" || o.class === "crypto") &&
    (o.mode === undefined || o.mode === "wheel" || o.mode === "pmcc")
  );
}

export async function POST(req: Request) {
  const user = await requireUser();
  await getOrCreateOptionsSettings(user.id);

  const body = (await req.json()) as Patch;
  const set: Record<string, unknown> = { updated_at: new Date() };

  if (typeof body.kill_switch === "boolean") set.kill_switch = body.kill_switch;
  if (typeof body.target_delta === "number") set.target_delta = body.target_delta;
  if (typeof body.dte_min === "number") set.dte_min = body.dte_min;
  if (typeof body.dte_max === "number") set.dte_max = body.dte_max;
  if (Array.isArray(body.underlyings) && body.underlyings.every(isUnderlying)) {
    set.underlyings = body.underlyings;
  }
  if (typeof body.pmcc_leaps_delta === "number") set.pmcc_leaps_delta = body.pmcc_leaps_delta;
  if (typeof body.pmcc_leaps_dte_min === "number") set.pmcc_leaps_dte_min = body.pmcc_leaps_dte_min;
  if (typeof body.pmcc_leaps_dte_max === "number") set.pmcc_leaps_dte_max = body.pmcc_leaps_dte_max;
  if (typeof body.pmcc_budget_usd === "number") set.pmcc_budget_usd = String(body.pmcc_budget_usd);

  const updated = await db
    .update(ai_options_settings)
    .set(set)
    .where(eq(ai_options_settings.user_id, user.id))
    .returning();

  return Response.json({ ok: true, settings: updated[0] });
}
