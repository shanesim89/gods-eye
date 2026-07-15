#!/usr/bin/env node
// Read-only verification that alpaca-chain.ts's approach (list contracts +
// per-symbol quote) produces sane numbers, cross-checked against the Yahoo
// real-chain sim from sim-lever3.mjs. No orders placed.
//
// Usage: node --env-file=.env.local scripts/alpaca-quote-check.mjs

const KEY = process.env.ALPACA_API_KEY_ID, SECRET = process.env.ALPACA_API_SECRET_KEY;
if (!KEY || !SECRET) { console.error("MISSING Alpaca creds"); process.exit(1); }
const H = { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET };

function normPdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }
function normCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const tt = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * tt - 1.453152027) * tt + 1.421413741) * tt - 0.284496736) * tt + 0.254829592) * tt * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}
function bsDelta(type, S, K, t, r, sigma) {
  const vsqrt = sigma * Math.sqrt(t);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * t) / vsqrt;
  return type === "C" ? normCdf(d1) : normCdf(d1) - 1;
}
function strikeForDelta(targetDelta, type, S, t, r, sigma) {
  let lo = S * 0.3, hi = S * 3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const d = Math.abs(bsDelta(type, S, mid, t, r, sigma));
    if (type === "C") { if (d > targetDelta) lo = mid; else hi = mid; }
    else { if (d > targetDelta) hi = mid; else lo = mid; }
  }
  return (lo + hi) / 2;
}

async function main() {
  const symbol = "SPY";
  const cfg = { targetDelta: 22, dteMin: 14, dteMax: 30 };
  const now = Date.now();

  // spot from Alpaca's own latest stock trade (keeps this check self-contained, no cross-source spot)
  const tradeR = await fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/trades/latest`, { headers: H });
  const trade = await tradeR.json();
  const spot = trade.trade?.p;
  if (!spot) { console.error("no spot"); process.exit(1); }
  const sigma = 0.19; // reuse SPY HV30 from sim-lever3.mjs run (19.0%) — this script only checks the Alpaca quote path

  const rawK = strikeForDelta(cfg.targetDelta / 100, "P", spot, (cfg.dteMin + cfg.dteMax) / 2 / 365, 0.04, sigma);
  const targetStrike = Math.min(Math.round(rawK), Math.round(spot * 0.99));

  const gte = new Date(now + cfg.dteMin * 86_400_000).toISOString().slice(0, 10);
  const lte = new Date(now + cfg.dteMax * 86_400_000).toISOString().slice(0, 10);
  const contractsUrl =
    `https://paper-api.alpaca.markets/v2/options/contracts?underlying_symbols=${symbol}&type=put&status=active` +
    `&expiration_date_gte=${gte}&expiration_date_lte=${lte}` +
    `&strike_price_gte=${(spot * 0.9).toFixed(0)}&strike_price_lte=${(spot * 0.99).toFixed(0)}&limit=100`;
  const cRes = await fetch(contractsUrl, { headers: H });
  const cJson = await cRes.json();
  const contracts = cJson.option_contracts ?? [];
  if (contracts.length === 0) { console.error("no contracts in window", { gte, lte }); process.exit(1); }
  const nearest = contracts.reduce((best, c) =>
    Math.abs(Number(c.strike_price) - targetStrike) < Math.abs(Number(best.strike_price) - targetStrike) ? c : best
  );

  const qRes = await fetch(`https://data.alpaca.markets/v1beta1/options/quotes/latest?symbols=${nearest.symbol}&feed=indicative`, { headers: H });
  const qJson = await qRes.json();
  const q = qJson.quotes?.[nearest.symbol];

  const dte = Math.round((new Date(nearest.expiration_date).getTime() - now) / 86_400_000);
  const delta = bsDelta("P", spot, Number(nearest.strike_price), dte / 365, 0.04, sigma);

  console.log(`SPY spot=$${spot.toFixed(2)}`);
  console.log(`ALPACA  Δ22 DTE14-30: symbol=${nearest.symbol} strike=$${nearest.strike_price} dte=${dte} bid=$${q?.bp ?? "?"} ask=$${q?.ap ?? "?"} OI=${nearest.open_interest} BSΔ=${delta.toFixed(3)}`);
  console.log(`(cross-check vs Yahoo sim-lever3.mjs run: strike=$728 dte=16 bid=$2.54 realΔ=-0.156)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
