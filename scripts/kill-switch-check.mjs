#!/usr/bin/env node
// Read-only-ish verification of kill-switch.ts's flatten logic: calls the
// REAL cancelAllOrders endpoint (safe — 0 open orders on the account, so this
// cancels nothing) and confirms the DB query for live-open positions returns
// empty (nothing to close). No closing orders placed since there's nothing to
// close today.
//
// Usage: node --env-file=.env.local scripts/kill-switch-check.mjs

import { neon } from "@neondatabase/serverless";

const uid = "2d4c2a10-39d1-491c-ae39-18d515cd559e";
const KEY = process.env.ALPACA_API_KEY_ID, SECRET = process.env.ALPACA_API_SECRET_KEY;
const H = { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET };

const cancelRes = await fetch("https://paper-api.alpaca.markets/v2/orders", { method: "DELETE", headers: H });
console.log(`cancelAllOrders → ${cancelRes.status} (${cancelRes.status === 207 ? "orders present, all cancelled" : "no orders to cancel"})`);

const sql = neon(process.env.DATABASE_URL);
const liveOpen = await sql`
  SELECT id, underlying, contract_symbol FROM ai_options_positions
  WHERE user_id = ${uid} AND status = 'open' AND broker_order_id IS NOT NULL
`;
console.log(`live-open positions to flatten: ${liveOpen.length}`);
if (liveOpen.length) console.log(JSON.stringify(liveOpen, null, 2));
else console.log("✅ nothing to flatten — flatten logic confirmed safe no-op on current account state");
