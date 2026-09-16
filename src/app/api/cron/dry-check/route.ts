import crypto from "node:crypto";
import { adapterFor, venueFor } from "@/lib/trading/router";

// TEMP diagnostic route — read-only. Never calls marketBuy or claimOrder.
// Delete after use. Secured by CRON_SECRET (same as other cron routes).
export const dynamic = "force-dynamic";

const TOKENS = ["BTC", "ETH", "SOL", "HYPE"];
const BUY_USD = 50;

// OKX runs region-specific API hosts; a key only exists on its own host.
// Probe the known hosts (same list as scripts/okx-check.mjs) to find which
// one recognizes this key — OKX_API_KEY auth is currently failing (50119)
// against the default host, so this narrows down the fix.
const OKX_HOSTS = process.env.OKX_BASE
  ? [process.env.OKX_BASE]
  : ["https://www.okx.com", "https://my.okx.com", "https://aws.okx.com", "https://eea.okx.com", "https://app.okx.com"];

function okxSign(ts: string, method: string, path: string) {
  return crypto.createHmac("sha256", process.env.OKX_API_SECRET!).update(ts + method + path).digest("base64");
}

async function probeOkxHosts() {
  const KEY = process.env.OKX_API_KEY;
  const SECRET = process.env.OKX_API_SECRET;
  const PASS = process.env.OKX_API_PASSPHRASE;
  if (!KEY || !SECRET || !PASS) return { error: "missing OKX_API_KEY/SECRET/PASSPHRASE" };

  const path = "/api/v5/account/balance?ccy=USDT";
  const attempts: Record<string, string> = {};
  for (const base of OKX_HOSTS) {
    const ts = new Date().toISOString();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "OK-ACCESS-KEY": KEY,
      "OK-ACCESS-SIGN": okxSign(ts, "GET", path),
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": PASS,
    };
    if (process.env.OKX_DEMO === "1") headers["x-simulated-trading"] = "1";
    try {
      const res = await fetch(base + path, { headers });
      const body = await res.json();
      if (body.code === "0") {
        const usdt = body.data?.[0]?.details?.find((d: { ccy: string }) => d.ccy === "USDT");
        return { workingHost: base, usdtAvailable: usdt?.availBal ?? "0", attempts };
      }
      attempts[base] = `code ${body.code}: ${body.msg}`;
    } catch (e) {
      attempts[base] = e instanceof Error ? e.message : "network error";
    }
  }
  return { workingHost: null, attempts };
}

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

  const okxHostProbe = await probeOkxHosts();

  return Response.json({ ok: true, dryRun: true, results, okxHostProbe });
}
