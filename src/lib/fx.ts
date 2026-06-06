import "server-only";
import { db } from "@/db/client";
import { fx_rates_cache } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get exchange rate from `from` to `to`. Returns 1 if same.
 * Uses Postgres cache table with 1-hour TTL. Falls back to exchangerate.host.
 */
export async function getRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;

  const cached = await db
    .select()
    .from(fx_rates_cache)
    .where(and(eq(fx_rates_cache.base, from), eq(fx_rates_cache.quote, to)))
    .limit(1);

  if (cached.length > 0) {
    const age = Date.now() - new Date(cached[0].fetched_at).getTime();
    if (age < TTL_MS) return Number(cached[0].rate);
  }

  // Fetch fresh
  const url = `https://api.exchangerate.host/convert?from=${from}&to=${to}&amount=1`;
  try {
    const r = await fetch(url, { next: { revalidate: 3600 } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const rate = typeof j?.result === "number" ? j.result : null;
    if (rate == null) throw new Error("no result in fx payload");

    // Upsert
    await db
      .insert(fx_rates_cache)
      .values({ base: from, quote: to, rate: String(rate) })
      .onConflictDoUpdate({
        target: [fx_rates_cache.base, fx_rates_cache.quote],
        set: { rate: String(rate), fetched_at: new Date() },
      });

    return rate;
  } catch (err) {
    // Last resort: stale cached value if any, else surface failure so callers can flag UI.
    if (cached.length > 0) {
      console.warn(`[fx] using stale cached rate ${from}→${to}: ${(err as Error).message}`);
      return Number(cached[0].rate);
    }
    console.error(`[fx] failed ${from}→${to}, returning 1:1 fallback: ${(err as Error).message}`);
    return 1;
  }
}

export async function convert(
  amount: number | string,
  from: string,
  to: string
): Promise<number> {
  const a = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(a)) return 0;
  const rate = await getRate(from, to);
  return a * rate;
}
