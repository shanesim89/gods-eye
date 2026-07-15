#!/usr/bin/env node
// Read-only verification that deribit-chain.ts's approach produces sane
// numbers for a BTC CSP. No orders — Deribit's public book-summary endpoint
// needs no API key.
//
// Usage: node scripts/deribit-quote-check.mjs

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

const MONTHS = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
function parseInstrument(name) {
  const parts = name.split("-");
  if (parts.length !== 4) return null;
  const [, dateStr, strikeStr, cp] = parts;
  const m = dateStr.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const expiryUnix = Math.floor(Date.UTC(2000 + Number(m[3]), MONTHS[m[2]], Number(m[1]), 8, 0, 0) / 1000);
  return { expiryUnix, strike: Number(strikeStr), type: cp === "C" ? "C" : "P" };
}

async function main() {
  const currency = "BTC";
  const cfg = { targetDelta: 22, dteMin: 14, dteMax: 30, riskFreeRate: 0.04 };
  const now = Date.now();

  const r = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`, { headers: { "User-Agent": "gods-eye/1.0" } });
  const j = await r.json();
  const rows = j.result;
  console.log(`fetched ${rows.length} ${currency} option rows`);

  const ups = rows.map(r => r.underlying_price).filter(p => typeof p === "number" && p > 0).sort((a,b)=>a-b);
  const spot = ups[Math.floor(ups.length / 2)];
  console.log(`BTC spot (median underlying_price): $${spot.toFixed(0)}`);

  const nowSec = now / 1000;
  const parsed = rows.map(r => { const p = parseInstrument(r.instrument_name); return p ? { ...r, ...p } : null; }).filter(Boolean);
  const inWindow = parsed.filter(p => {
    const dte = (p.expiryUnix - nowSec) / 86400;
    return dte >= cfg.dteMin && dte <= cfg.dteMax;
  });
  const expirations = [...new Set(inWindow.map(p => p.expiryUnix))].sort((a,b)=>a-b);
  console.log(`expiries in ${cfg.dteMin}-${cfg.dteMax}d window:`, expirations.map(e => new Date(e*1000).toISOString().slice(0,10)));
  if (expirations.length === 0) { console.log("no expiry in window — nothing to check"); return; }
  const targetExp = expirations[0];

  const puts = inWindow.filter(p => p.expiryUnix === targetExp && p.type === "P" && p.strike < spot);
  const sigma = 0.55; // rough BTC IV ballpark for the delta-targeting math only
  const rawK = strikeForDelta(cfg.targetDelta / 100, "P", spot, (cfg.dteMin+cfg.dteMax)/2/365, cfg.riskFreeRate, sigma);
  const targetStrike = Math.min(rawK, spot * 0.99);
  const nearest = puts.reduce((best, p) => Math.abs(p.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? p : best, puts[0]);
  if (!nearest) { console.log("no put candidates in window"); return; }

  const bidUsd = (nearest.bid_price || 0) * spot;
  const askUsd = (nearest.ask_price || 0) * spot;
  const dte = Math.round((targetExp - nowSec) / 86400);
  console.log(`ALPACA-style output — ${nearest.instrument_name}: strike=$${nearest.strike} dte=${dte} bid=$${bidUsd.toFixed(0)} ask=$${askUsd.toFixed(0)} OI=${nearest.open_interest} markIV=${nearest.mark_iv}%`);
}

main().catch(e => { console.error(e); process.exit(1); });
