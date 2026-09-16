import { adapterFor, venueFor } from "@/lib/trading/router";

// TEMP diagnostic route — read-only. Never calls marketBuy or claimOrder.
// Delete after use. Secured by CRON_SECRET (same as other cron routes).
export const dynamic = "force-dynamic";

const TOKENS = ["BTC", "ETH", "SOL", "HYPE"];
const BUY_USD = 50;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const results: Record<string, unknown> = {};
  for (const token of TOKENS) {
    const adapter = adapterFor(token);
    try {
      const [price, balance] = await Promise.all([adapter.getPrice(token), adapter.getUsdBalance()]);
      results[token] = {
        venue: venueFor(token),
        price,
        balance,
        wouldBuyUsd: BUY_USD,
        sufficient: balance >= BUY_USD,
      };
    } catch (err) {
      results[token] = { venue: venueFor(token), error: err instanceof Error ? err.message : "unknown" };
    }
  }

  return Response.json({ ok: true, dryRun: true, results });
}
