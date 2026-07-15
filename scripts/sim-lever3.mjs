#!/usr/bin/env node
// Read-only sim: current CSP config (Δ22, DTE 14-30) vs lever-3 proposal
// (Δ28 / Δ30, DTE 30-45) against REAL live Yahoo option chains. No DB writes,
// no trades — just fetches quotes and prices strikes with the same
// Black-Scholes math the engine uses (blackscholes.ts, copied verbatim).
//
// Usage: node scripts/sim-lever3.mjs

const RISK_FREE = 0.04;
const SYMBOLS = ["SPY", "AAPL"];
const CONFIGS = [
  ["CURRENT  Δ22 DTE14-30", { targetDelta: 22, dteMin: 14, dteMax: 30 }],
  ["PROPOSED Δ28 DTE30-45", { targetDelta: 28, dteMin: 30, dteMax: 45 }],
  ["PROPOSED Δ30 DTE30-45", { targetDelta: 30, dteMin: 30, dteMax: 45 }],
];

// ── Black-Scholes (verbatim from src/lib/options/blackscholes.ts) ──────────
function normPdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }
function normCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const tt = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * tt - 1.453152027) * tt + 1.421413741) * tt - 0.284496736) * tt + 0.254829592) * tt * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}
function d1d2({ S, K, t, r, sigma }) {
  const vsqrt = sigma * Math.sqrt(t);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * t) / vsqrt;
  return { d1, d2: d1 - vsqrt };
}
function bsGreeks(inp) {
  const { type, S, K, t, r, sigma } = inp;
  if (t <= 0 || sigma <= 0) return { delta: type === "C" ? (S > K ? 1 : 0) : (S < K ? -1 : 0) };
  const { d1 } = d1d2(inp);
  const delta = type === "C" ? normCdf(d1) : normCdf(d1) - 1;
  return { delta };
}
function strikeForDelta(targetDelta, type, S, t, r, sigma) {
  const target = Math.abs(targetDelta);
  let lo = S * 0.3, hi = S * 3;
  const deltaAt = (K) => Math.abs(bsGreeks({ type, S, K, t, r, sigma }).delta);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const d = deltaAt(mid);
    if (type === "C") { if (d > target) lo = mid; else hi = mid; }
    else { if (d > target) hi = mid; else lo = mid; }
  }
  return (lo + hi) / 2;
}
function roundStrike(K) {
  if (K >= 1000) return Math.round(K / 5) * 5;
  if (K >= 100) return Math.round(K);
  if (K >= 25) return Math.round(K * 2) / 2;
  return Math.round(K * 10) / 10;
}
function yearsTo(expiryMs, nowMs) {
  const ms = expiryMs - nowMs;
  return Math.max(1 / (365 * 24), ms / (365 * 86_400_000));
}
function histVol(series, fallback = 0.4) {
  if (!series || series.length < 5) return fallback;
  const rets = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i];
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 4) return fallback;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
  const annual = Math.sqrt(variance) * Math.sqrt(365);
  if (!Number.isFinite(annual) || annual <= 0) return fallback;
  return Math.min(2.5, Math.max(0.1, annual));
}

// ── screener-util (verbatim) ────────────────────────────────────────────────
function midPrice(row) {
  if (row.bid > 0 && row.ask > 0) return (row.bid + row.ask) / 2;
  return row.lastPrice > 0 ? row.lastPrice : Math.max(row.bid, row.ask);
}
function spreadPct(row) {
  const m = midPrice(row);
  if (m <= 0 || row.bid <= 0 || row.ask <= 0) return 1;
  return (row.ask - row.bid) / m;
}
function expiryInWindow(expirations, dteMin, dteMax, nowMs) {
  const nowSec = nowMs / 1000;
  const inWindow = expirations.filter((e) => {
    const dte = (e - nowSec) / 86_400;
    return dte >= dteMin && dte <= dteMax;
  });
  if (inWindow.length > 0) return inWindow[0];
  const past = expirations.filter((e) => (e - nowSec) / 86_400 >= dteMin);
  return past.length > 0 ? past[0] : null;
}

// ── Yahoo chain fetch (same cookie+crumb dance as src/lib/yahoo.ts) ────────
let session = null;
function parseCookieHeader(raw) {
  return raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}
async function tryGetCookie(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow", cache: "no-store" });
    const raw = r.headers.get("set-cookie");
    return raw ? parseCookieHeader(raw) || null : null;
  } catch { return null; }
}
async function getSession() {
  if (session) return session;
  const cookie = (await tryGetCookie("https://fc.yahoo.com")) ?? (await tryGetCookie("https://finance.yahoo.com"));
  if (!cookie) return null;
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie }, cache: "no-store" });
  if (!crumbRes.ok) return null;
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 64) return null;
  session = { cookie, crumb };
  return session;
}
async function getYahooOptions(symbol, expirationUnix) {
  const sess = await getSession();
  if (!sess) return null;
  const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(sess.crumb)}` + (expirationUnix ? `&date=${expirationUnix}` : "");
  const r = await fetch(url, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0", Cookie: sess.cookie }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const j = await r.json();
  const res = j.optionChain?.result?.[0];
  if (!res) return null;
  const block = res.options?.[0];
  if (!block) return null;
  const toRow = (c) => ({ strike: c.strike ?? 0, lastPrice: c.lastPrice ?? 0, bid: c.bid ?? 0, ask: c.ask ?? 0, openInterest: c.openInterest ?? 0, impliedVolatility: c.impliedVolatility ?? 0 });
  return {
    underlyingPrice: res.quote?.regularMarketPrice ?? 0,
    expirations: res.expirationDates ?? [],
    expiry: block.expirationDate,
    calls: (block.calls ?? []).map(toRow).sort((a, b) => a.strike - b.strike),
    puts: (block.puts ?? []).map(toRow).sort((a, b) => a.strike - b.strike),
  };
}
async function getChart(symbol, days) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${days}d&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  const res = j.chart?.result?.[0];
  const closes = res?.indicators?.quote?.[0]?.close ?? [];
  return closes.filter((c) => typeof c === "number");
}

// ── fetchRealCSPQuote equivalent (same logic as wheel-chain.ts) ────────────
async function fetchRealCSP(symbol, spot, sigma, cfg, nowMs) {
  const approxT = (cfg.dteMin + cfg.dteMax) / 2 / 365;
  const rawK = strikeForDelta(cfg.targetDelta / 100, "P", spot, approxT, RISK_FREE, sigma);
  let targetStrike = roundStrike(Math.min(rawK, spot));
  if (targetStrike >= spot) targetStrike = roundStrike(spot * 0.99);

  const probe = await getYahooOptions(symbol);
  if (!probe || probe.expirations.length === 0) return { fail: "no chain" };
  const exp = expiryInWindow(probe.expirations, cfg.dteMin, cfg.dteMax, nowMs);
  if (!exp) return { fail: "no expiry in window" };
  const chain = exp === probe.expiry ? probe : await getYahooOptions(symbol, exp);
  if (!chain) return { fail: "chain fetch failed" };
  const candidates = chain.puts.filter((r) => r.strike < spot);
  if (candidates.length === 0) return { fail: "no OTM puts" };
  const row = candidates.reduce((best, r) => (Math.abs(r.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? r : best));
  if (row.openInterest < 50) return { fail: `OI ${row.openInterest} < 50` };
  if (spreadPct(row) > 0.15) return { fail: `spread ${(spreadPct(row) * 100).toFixed(0)}% > 15%` };
  if (row.bid <= 0) return { fail: "no real bid" };

  const expiryMs = exp * 1000;
  const dte = Math.round((expiryMs - nowMs) / 86_400_000);
  const iv = row.impliedVolatility > 0 ? row.impliedVolatility : 0.3;
  const t = yearsTo(expiryMs, nowMs);
  const greeks = bsGreeks({ type: "P", S: chain.underlyingPrice, K: row.strike, t, r: RISK_FREE, sigma: iv });
  return { strike: row.strike, dte, bid: row.bid, ask: row.ask, oi: row.openInterest, spread: spreadPct(row), iv, delta: greeks.delta };
}

async function run() {
  const nowMs = Date.now();
  for (const symbol of SYMBOLS) {
    const closes = await getChart(symbol, 45).catch(() => null);
    const probe = await getYahooOptions(symbol).catch(() => null);
    const spot = probe?.underlyingPrice;
    if (!spot) { console.log(`${symbol}: no spot/chain, skip`); continue; }
    const sigma = histVol(closes?.slice(-30), 0.25);
    console.log(`\n=== ${symbol}  spot=$${spot.toFixed(2)}  HV30=${(sigma * 100).toFixed(1)}% ===`);

    for (const [label, cfg] of CONFIGS) {
      const q = await fetchRealCSP(symbol, spot, sigma, cfg, nowMs);
      if (q.fail) { console.log(`  ${label}: NO QUOTE (${q.fail})`); continue; }
      const annYield = ((q.bid * 100) / (q.strike * 100)) * (365 / q.dte) * 100;
      const pop = (1 - Math.abs(q.delta)) * 100;
      console.log(
        `  ${label}: strike=$${q.strike} dte=${q.dte} bid=$${q.bid.toFixed(2)} ask=$${q.ask.toFixed(2)} ` +
        `realΔ=${q.delta.toFixed(3)} POP≈${pop.toFixed(1)}% IV=${(q.iv * 100).toFixed(1)}% OI=${q.oi} ` +
        `spread=${(q.spread * 100).toFixed(1)}% ann.yield=${annYield.toFixed(1)}%`
      );
    }
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
