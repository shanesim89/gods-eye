#!/usr/bin/env node
// Read-only verification of reconcile.ts's query logic — same DB query +
// Alpaca positions fetch, run standalone since reconcile.ts is server-only.
//
// Usage: node --env-file=.env.local scripts/reconcile-check.mjs

import { neon } from "@neondatabase/serverless";

const uid = "2d4c2a10-39d1-491c-ae39-18d515cd559e";
const sql = neon(process.env.DATABASE_URL);
const KEY = process.env.ALPACA_API_KEY_ID, SECRET = process.env.ALPACA_API_SECRET_KEY;
const H = { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET };

const dbRows = await sql`
  SELECT id, contract_symbol FROM ai_options_positions
  WHERE user_id = ${uid} AND status = 'open' AND broker_order_id IS NOT NULL
`;
const brokerPositions = await fetch("https://paper-api.alpaca.markets/v2/positions", { headers: H }).then(r => r.json());

const dbSymbols = new Set(dbRows.map(r => r.contract_symbol));
const brokerSymbols = new Set(brokerPositions.map(p => p.symbol));

const mismatches = [];
for (const row of dbRows) if (!brokerSymbols.has(row.contract_symbol)) mismatches.push({ kind: "missing_at_broker", ...row });
for (const pos of brokerPositions) if (!dbSymbols.has(pos.symbol)) mismatches.push({ kind: "unexpected_at_broker", symbol: pos.symbol, qty: pos.qty });

console.log(`DB live-open positions: ${dbRows.length}`);
console.log(`Broker positions: ${brokerPositions.length}`);
console.log(`Mismatches: ${mismatches.length}`);
if (mismatches.length) console.log(JSON.stringify(mismatches, null, 2));
console.log(mismatches.length === 0 ? "✅ clean" : "⚠️ reconciliation gap");
