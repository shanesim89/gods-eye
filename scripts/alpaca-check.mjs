#!/usr/bin/env node
// Read-only Alpaca paper-account auth check. Confirms ALPACA_API_KEY_ID +
// ALPACA_API_SECRET_KEY are valid and options trading is enabled on the
// paper account. Does NOT place any order.
//
// Usage: node --env-file=.env.local scripts/alpaca-check.mjs

const { ALPACA_API_KEY_ID: KEY, ALPACA_API_SECRET_KEY: SECRET } = process.env;

if (!KEY || !SECRET) {
  console.error("MISSING creds. Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (paper keys from https://app.alpaca.markets/paper/dashboard/overview).");
  process.exit(1);
}

const BASE = "https://paper-api.alpaca.markets";
const headers = { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET };

async function main() {
  const acctRes = await fetch(`${BASE}/v2/account`, { headers, cache: "no-store" });
  if (!acctRes.ok) {
    console.error(`Account check FAILED: ${acctRes.status} ${await acctRes.text()}`);
    process.exit(1);
  }
  const acct = await acctRes.json();
  console.log(`✅ Auth OK — account ${acct.account_number} (${acct.status})`);
  console.log(`   cash=$${acct.cash}  buying_power=$${acct.buying_power}  options_trading_level=${acct.options_trading_level ?? "n/a"}`);

  if (!acct.options_trading_level || Number(acct.options_trading_level) < 1) {
    console.warn("⚠️  Options trading does not appear enabled on this account — enable it in the Alpaca dashboard before continuing.");
  }

  const cfgRes = await fetch(`${BASE}/v2/account/configurations`, { headers, cache: "no-store" });
  if (cfgRes.ok) {
    const cfg = await cfgRes.json();
    console.log(`   trade_confirm_email=${cfg.trade_confirm_email} suspend_trade=${cfg.suspend_trade}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
