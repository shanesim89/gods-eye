import { runScan, writeScanCache, writeHistory, getYesterdaySnapshot } from "@/lib/crypto/scanner";
import { runScannerAlerts } from "@/lib/crypto/scanner-alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily (vercel.json). Pre-computes the moonshot scan so the page loads
// instantly from cache, writes the daily history snapshot, and pushes a
// Telegram digest of notable score changes. Secured by CRON_SECRET
// (Vercel Cron sends it as Authorization: Bearer).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const result = await runScan();
    if (result.coins.length === 0) {
      return Response.json(
        { ok: false, error: "scan returned no coins (CoinGecko outage or rate limit)" },
        { status: 502 }
      );
    }
    await writeScanCache(result);
    // Snapshot must be read BEFORE writeHistory only if same-day collision were
    // possible — getYesterdaySnapshot filters scanned_date < today, so order is safe.
    await writeHistory(result);
    const yesterday = await getYesterdaySnapshot();
    const alerts = await runScannerAlerts(result, yesterday);
    return Response.json({
      ok: true,
      universe: result.universe,
      passed: result.passed,
      kept: result.coins.length,
      alerts,
      generatedAt: result.generatedAt,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
