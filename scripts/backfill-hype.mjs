// Backfill the manual HYPE buy (1.0 @ $55.974, oid 465570890786) into Neon.
// Idempotent: order ON CONFLICT DO NOTHING; asset guarded by existence check.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// --- load .env.local ---
const env = {};
const envFile = process.argv[2] ?? "../.env.local";
for (const line of readFileSync(new URL(envFile, import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "").replace(/\\n$/, "");
}
if (!env.DATABASE_URL) throw new Error("DATABASE_URL missing in .env.local");

const sql = neon(env.DATABASE_URL);

const USER = "2d4c2a10-39d1-491c-ae39-18d515cd559e";
const OID = "465570890786";
const IDEM = `${USER}:HYPE:manual-${OID}`;
const QTY = "1.00000000";
const PRICE = "55.97400000";
const USD = "55.94";

// 1) audit-log row
const ord = await sql`
  INSERT INTO ai_trade_orders
    (user_id, token, venue, side, usd_amount, qty, price, boosted, status, idempotency_key, exchange_order_id)
  VALUES
    (${USER}, 'HYPE', 'hyperliquid', 'buy', ${USD}, ${QTY}, ${PRICE}, false, 'filled', ${IDEM}, ${OID})
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id`;
console.log(ord.length ? `order inserted: ${ord[0].id}` : "order already present (skip)");

// 2) holdings row — guard against dup (no unique key on assets)
const existing = await sql`
  SELECT id FROM assets
  WHERE user_id = ${USER} AND ticker = 'HYPE' AND asset_class = 'crypto' AND cost_basis = ${USD}
  LIMIT 1`;
if (existing.length) {
  console.log(`asset already present (skip): ${existing[0].id}`);
} else {
  const a = await sql`
    INSERT INTO assets (user_id, ticker, name, qty, cost_basis, currency, asset_class)
    VALUES (${USER}, 'HYPE', 'HYPE', ${QTY}, ${USD}, 'USD', 'crypto')
    RETURNING id`;
  console.log(`asset inserted: ${a[0].id}`);
}

console.log("done.");
