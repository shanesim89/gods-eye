#!/usr/bin/env node
// Read-only OKX V5 auth check. Validates API key + secret + passphrase + request
// signing WITHOUT placing any order. Run before relying on the live OKX path.
//
// Usage (PowerShell):
//   $env:OKX_API_KEY="..."; $env:OKX_API_SECRET="..."; $env:OKX_API_PASSPHRASE="..."; node scripts/okx-check.mjs
// Usage (bash):
//   OKX_API_KEY=... OKX_API_SECRET=... OKX_API_PASSPHRASE=... node scripts/okx-check.mjs
// Add OKX_DEMO=1 to test demo-trading keys instead of live.

import crypto from "node:crypto";

const DEMO = process.env.OKX_DEMO === "1";
const { OKX_API_KEY: KEY, OKX_API_SECRET: SECRET, OKX_API_PASSPHRASE: PASS } = process.env;

if (!KEY || !SECRET || !PASS) {
  console.error("MISSING creds. Set OKX_API_KEY, OKX_API_SECRET, OKX_API_PASSPHRASE.");
  process.exit(1);
}

// OKX runs region-specific API hosts; a key only exists on its own host. Probe
// the known hosts to find which one recognizes this key. OKX_BASE overrides.
const HOSTS = process.env.OKX_BASE
  ? [process.env.OKX_BASE]
  : ["https://www.okx.com", "https://my.okx.com", "https://aws.okx.com", "https://eea.okx.com", "https://app.okx.com"];

function sign(ts, method, path, body = "") {
  return crypto.createHmac("sha256", SECRET).update(ts + method + path + body).digest("base64");
}

async function priv(base, method, path) {
  const ts = new Date().toISOString();
  const headers = {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": KEY,
    "OK-ACCESS-SIGN": sign(ts, method, path),
    "OK-ACCESS-TIMESTAMP": ts,
    "OK-ACCESS-PASSPHRASE": PASS,
  };
  if (DEMO) headers["x-simulated-trading"] = "1";
  const res = await fetch(base + path, { method, headers });
  return res.json().catch(() => ({ code: "-1", msg: `HTTP ${res.status} non-JSON` }));
}

console.log(`mode: ${DEMO ? "DEMO" : "LIVE"}  — probing ${HOSTS.length} host(s)`);

let winner = null;
for (const base of HOSTS) {
  let bal;
  try {
    bal = await priv(base, "GET", "/api/v5/account/balance?ccy=USDT");
  } catch (e) {
    console.log(`  ${base}  → network error: ${e.message}`);
    continue;
  }
  if (bal.code === "0") {
    const usdt = bal.data?.[0]?.details?.find((d) => d.ccy === "USDT");
    console.log(`  ${base}  → AUTH OK ✓  USDT available: ${usdt?.availBal ?? "0"}`);
    winner = base;
    break;
  }
  console.log(`  ${base}  → code ${bal.code}: ${bal.msg}`);
}

if (winner) {
  console.log(`\n✅ WORKING HOST: ${winner}`);
  console.log(`Set OKX_BASE="${winner}" in env (local + Vercel) and you're live.`);
} else {
  console.error(`\n❌ No host recognized the key.`);
  console.error("50119 everywhere = key value wrong or creation not completed.");
  console.error("50113 = signature/secret issue. 50105 = passphrase. 50110 = IP whitelist.");
  process.exit(1);
}
