import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { ACTIVE_STATE_CACHE_KEYS } from "@/lib/ai-portfolio/registry";

export const dynamic = "force-dynamic";

// Only bot-state rows may be polled from the client — never an arbitrary cache key.
const ALLOWED = new Set<string>(ACTIVE_STATE_CACHE_KEYS);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  await requireUser();

  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  if (!ALLOWED.has(key)) {
    return Response.json({ error: "unknown key" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, key))
    .limit(1);

  if (rows.length === 0) {
    return Response.json({ payload: null, fetched_at: null });
  }
  return Response.json({ payload: rows[0].payload, fetched_at: rows[0].fetched_at });
}
