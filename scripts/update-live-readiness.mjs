#!/usr/bin/env node
// Pushes scripts/live-readiness-state.json into market_data_cache under key
// "options:live_readiness" — quant-scrap/morning_digest.py reads this key
// (Monday-only block) to give a weekly live-trading-readiness update in the
// existing Telegram digest, same read-through pattern already used for
// gold/mcscalp/dipbounce state.
//
// Run after editing live-readiness-state.json:
//   node --env-file=.env.local scripts/update-live-readiness.mjs

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("MISSING DATABASE_URL. Run with: node --env-file=.env.local scripts/update-live-readiness.mjs");
  process.exit(1);
}

const state = JSON.parse(readFileSync(new URL("./live-readiness-state.json", import.meta.url), "utf8"));
state.updated_at = new Date().toISOString();

const sql = neon(DATABASE_URL);
await sql`
  INSERT INTO market_data_cache (ticker, payload, fetched_at)
  VALUES ('options:live_readiness', ${JSON.stringify(state)}::jsonb, now())
  ON CONFLICT (ticker) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()
`;
console.log(`Pushed live-readiness state — overall ${state.overall_pct}%, current: ${state.current_milestone}`);
