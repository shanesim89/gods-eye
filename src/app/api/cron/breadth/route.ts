import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { computeBreadth } from "@/lib/market-stress/breadth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Full S&P 500 constituent scan. Too heavy for a page-request-triggered fetch
// (500 Yahoo calls), so it's invoked once daily from the digest cron (see
// api/cron/digest/route.ts — Vercel Hobby caps at 2 scheduled crons, already
// used by dca+digest) and writes the result to market_data_cache;
// /indicators just reads it. Kept as its own route so it can also be hit
// manually (CRON_SECRET-gated) to seed/refresh the cache on demand.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const snapshot = await computeBreadth();
    await db
      .insert(market_data_cache)
      .values({ ticker: "mstress:breadth", payload: snapshot, fetched_at: new Date() })
      .onConflictDoUpdate({
        target: market_data_cache.ticker,
        set: { payload: snapshot, fetched_at: new Date() },
      });
    return Response.json({ ok: true, snapshot });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}
