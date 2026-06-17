import "server-only";
import crypto from "node:crypto";
import { ExchangeError, type ExchangeAdapter, type MarketBuyResult } from "./exchange";

// OKX V5 spot adapter. Used for the major coins (BTC/ETH/SOL) that Hyperliquid
// spot does not list. Quote currency is USDT (treated as USD for DCA sizing).
//
// Auth: every private call signs OK-ACCESS-SIGN =
//   base64(HMAC_SHA256(secret, timestamp + method + requestPath + body))
// with the ISO timestamp echoed in OK-ACCESS-TIMESTAMP and the account
// passphrase in OK-ACCESS-PASSPHRASE. requestPath MUST include the query string.
//
// Live by default. Set OKX_DEMO=1 to route to demo trading (adds the
// x-simulated-trading header); demo and live use DIFFERENT API keys.

// OKX runs region-specific API hosts (a key only exists on its own host —
// e.g. SG accounts may not resolve on www.okx.com → error 50119). Override with
// OKX_BASE; defaults to the global host. Use scripts/okx-check.mjs to find it.
const BASE = process.env.OKX_BASE || "https://www.okx.com";
const DEMO = process.env.OKX_DEMO === "1";

function creds(): { key: string; secret: string; passphrase: string } {
  const key = process.env.OKX_API_KEY;
  const secret = process.env.OKX_API_SECRET;
  const passphrase = process.env.OKX_API_PASSPHRASE;
  if (!key || !secret || !passphrase) {
    throw new ExchangeError(
      "okx",
      "missing OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE",
    );
  }
  return { key, secret, passphrase };
}

function sign(secret: string, ts: string, method: string, path: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(ts + method + path + body).digest("base64");
}

async function okxFetch(
  method: "GET" | "POST",
  path: string,
  bodyObj?: unknown,
  auth = true,
): Promise<{ code: string; msg?: string; data?: Array<Record<string, string>> }> {
  const ts = new Date().toISOString();
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (DEMO) headers["x-simulated-trading"] = "1";
  if (auth) {
    const { key, secret, passphrase } = creds();
    headers["OK-ACCESS-KEY"] = key;
    headers["OK-ACCESS-SIGN"] = sign(secret, ts, method, path, body);
    headers["OK-ACCESS-TIMESTAMP"] = ts;
    headers["OK-ACCESS-PASSPHRASE"] = passphrase;
  }

  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body: body || undefined });
  } catch (e) {
    throw new ExchangeError("okx", `network error on ${path}: ${e instanceof Error ? e.message : e}`);
  }
  const json = await res.json().catch(() => ({ code: "-1", msg: `non-JSON response (HTTP ${res.status})` }));
  if (json.code && json.code !== "0") {
    const detail = json.data?.[0]?.sMsg || json.msg || JSON.stringify(json.data?.[0] ?? json);
    throw new ExchangeError("okx", `${method} ${path.split("?")[0]} → code ${json.code}: ${detail}`);
  }
  return json;
}

function instId(token: string): string {
  return `${token.toUpperCase()}-USDT`;
}

export class OkxAdapter implements ExchangeAdapter {
  readonly venue = "okx" as const;

  async getPrice(token: string): Promise<number> {
    // Public market-data endpoint — no auth required.
    const j = await okxFetch("GET", `/api/v5/market/ticker?instId=${instId(token)}`, undefined, false);
    const last = j.data?.[0]?.last;
    if (!last) throw new ExchangeError("okx", `no price for ${instId(token)}`);
    return parseFloat(last);
  }

  async getUsdBalance(): Promise<number> {
    const j = await okxFetch("GET", `/api/v5/account/balance?ccy=USDT`);
    const details = j.data?.[0]?.details as Array<Record<string, string>> | undefined;
    const usdt = details?.find((d) => d.ccy === "USDT");
    return usdt ? parseFloat(usdt.availBal || usdt.cashBal || "0") : 0;
  }

  async marketBuy(token: string, usdAmount: number): Promise<MarketBuyResult> {
    const inst = instId(token);
    // Spot market BUY sized in quote currency (USDT): tgtCcy=quote_ccy means
    // sz is the USDT amount to spend, not the base-asset quantity.
    const placed = await okxFetch("POST", `/api/v5/trade/order`, {
      instId: inst,
      tdMode: "cash",
      side: "buy",
      ordType: "market",
      sz: usdAmount.toString(),
      tgtCcy: "quote_ccy",
    });
    const o = placed.data?.[0];
    if (!o || o.sCode !== "0") {
      throw new ExchangeError("okx", `order rejected: ${o?.sCode ?? "?"} ${o?.sMsg ?? ""}`.trim());
    }
    const ordId = o.ordId;

    // Market orders fill near-instantly; poll the order for fill details.
    for (let i = 0; i < 6; i++) {
      const q = await okxFetch("GET", `/api/v5/trade/order?instId=${inst}&ordId=${ordId}`);
      const d = q.data?.[0];
      if (d && d.state === "filled") {
        const qty = parseFloat(d.accFillSz);
        const price = parseFloat(d.avgPx);
        if (qty > 0 && price > 0) return { orderId: ordId, qty, price };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    // Do NOT fabricate a fill — let the engine mark it failed and reconcile.
    throw new ExchangeError(
      "okx",
      `order ${ordId} not confirmed filled — verify on OKX before next run`,
    );
  }
}
