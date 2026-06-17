#!/usr/bin/env node
// ⚠ REAL MONEY. Places real OKX spot market BUYS. Test-fire helper.
// Default = dry run (prints what it WOULD do). To actually buy, set CONFIRM=FIRE.
//
// Usage (PowerShell) — dry run first:
//   $env:OKX_BASE="https://my.okx.com"
//   $env:OKX_API_KEY="..."; $env:OKX_API_SECRET="..."; $env:OKX_API_PASSPHRASE="..."
//   node scripts/okx-testbuy.mjs
// Then to fire for real:
//   $env:CONFIRM="FIRE"; node scripts/okx-testbuy.mjs

import crypto from "node:crypto";

const BASE = process.env.OKX_BASE || "https://www.okx.com";
const DEMO = process.env.OKX_DEMO === "1";
const FIRE = process.env.CONFIRM === "FIRE";
const { OKX_API_KEY: KEY, OKX_API_SECRET: SECRET, OKX_API_PASSPHRASE: PASS } = process.env;

const ORDERS = [
  { token: "BTC", usd: 20 },
  { token: "ETH", usd: 20 },
  { token: "SOL", usd: 20 },
];

if (!KEY || !SECRET || !PASS) {
  console.error("MISSING creds. Set OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE.");
  process.exit(1);
}

function sign(ts, method, path, body = "") {
  return crypto.createHmac("sha256", SECRET).update(ts + method + path + body).digest("base64");
}
async function okx(method, path, bodyObj) {
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
  return res.json();
}

console.log(`host: ${BASE}  mode: ${DEMO ? "DEMO" : "LIVE"}  ${FIRE ? "🔴 FIRING REAL ORDERS" : "🟡 DRY RUN (set CONFIRM=FIRE to buy)"}`);

// Balance check
const bal = await okx("GET", "/api/v5/account/balance?ccy=USDT");
if (bal.code !== "0") { console.error(`balance check failed: ${bal.code} ${bal.msg}`); process.exit(1); }
const usdt = parseFloat(bal.data?.[0]?.details?.find((d) => d.ccy === "USDT")?.availBal ?? "0");
const need = ORDERS.reduce((s, o) => s + o.usd, 0);
console.log(`USDT available: ${usdt}  | need: ${need}`);
if (usdt < need) { console.error(`INSUFFICIENT USDT (${usdt} < ${need}). Fund OKX first.`); process.exit(1); }

if (!FIRE) {
  console.log("\nWould place (dry run):");
  for (const o of ORDERS) console.log(`  BUY $${o.usd} ${o.token}-USDT (spot market)`);
  console.log("\nRe-run with  $env:CONFIRM=\"FIRE\"  to execute.");
  process.exit(0);
}

for (const o of ORDERS) {
  const inst = `${o.token}-USDT`;
  const placed = await okx("POST", "/api/v5/trade/order", {
    instId: inst, tdMode: "cash", side: "buy", ordType: "market",
    sz: String(o.usd), tgtCcy: "quote_ccy",
  });
  const d = placed.data?.[0];
  if (placed.code !== "0" || !d || d.sCode !== "0") {
    console.error(`  ${inst}: REJECTED — code ${placed.code} sCode ${d?.sCode} ${d?.sMsg || placed.msg}`);
    continue;
  }
  // fetch fill
  let filled = null;
  for (let i = 0; i < 6; i++) {
    const q = await okx("GET", `/api/v5/trade/order?instId=${inst}&ordId=${d.ordId}`);
    const r = q.data?.[0];
    if (r && r.state === "filled") { filled = r; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (filled) console.log(`  ${inst}: ✅ filled ${filled.accFillSz} @ ${filled.avgPx} (ordId ${d.ordId})`);
  else console.log(`  ${inst}: placed ordId ${d.ordId} — fill not confirmed, check OKX`);
}
console.log("\nDone. Verify positions in OKX.");
