// One-off manual buy on OKX spot. Real money. Mirrors OkxAdapter.marketBuy.
// Usage: node scripts/test-buy.mjs [TOKEN] [USD_AMOUNT]   (defaults: HYPE 10)
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const TOKEN = (process.argv[2] || "HYPE").toUpperCase();
const USD = parseFloat(process.argv[3] || "10");

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "").replace(/\\n$/, "");
}

const { OKX_API_KEY: KEY, OKX_API_SECRET: SECRET, OKX_API_PASSPHRASE: PASS, OKX_BASE, OKX_DEMO } = env;
if (!KEY || !SECRET || !PASS) throw new Error("missing OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE in .env.local");
const BASE = OKX_BASE || "https://www.okx.com";
const DEMO = OKX_DEMO === "1";
const INST = `${TOKEN}-USDT`;

function sign(ts, method, path, body = "") {
  return crypto.createHmac("sha256", SECRET).update(ts + method + path + body).digest("base64");
}

async function okxFetch(method, path, bodyObj) {
  const ts = new Date().toISOString();
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  const headers = {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": KEY,
    "OK-ACCESS-SIGN": sign(ts, method, path, body),
    "OK-ACCESS-TIMESTAMP": ts,
    "OK-ACCESS-PASSPHRASE": PASS,
  };
  if (DEMO) headers["x-simulated-trading"] = "1";
  const res = await fetch(BASE + path, { method, headers, body: body || undefined });
  return res.json().catch(() => ({ code: "-1", msg: `HTTP ${res.status} non-JSON` }));
}

console.log(`mode: ${DEMO ? "DEMO" : "LIVE"}  host: ${BASE}`);
console.log(`\nPLACING: market BUY $${USD} of ${INST}\n`);

const placed = await okxFetch("POST", "/api/v5/trade/order", {
  instId: INST,
  tdMode: "cash",
  side: "buy",
  ordType: "market",
  sz: USD.toString(),
  tgtCcy: "quote_ccy",
});
const o = placed.data?.[0];
if (!o || o.sCode !== "0") {
  throw new Error(`order rejected: ${o?.sCode ?? placed.code} ${o?.sMsg ?? placed.msg ?? ""}`.trim());
}
console.log("order placed, ordId:", o.ordId, "— polling for fill...");

for (let i = 0; i < 6; i++) {
  const q = await okxFetch("GET", `/api/v5/trade/order?instId=${INST}&ordId=${o.ordId}`);
  const d = q.data?.[0];
  if (d?.state === "filled") {
    console.log(`\n✅ FILLED: ${d.accFillSz} ${TOKEN} @ avg ${d.avgPx} (ordId ${o.ordId})`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 500));
}
console.log("\n⚠️ NOT CONFIRMED FILLED — check OKX directly for ordId", o.ordId);
