// Options decision analytics — pure, source-agnostic, unit-testable.
// Consumes a NormalizedChain (Yahoo or Deribit) + a selected contract and
// produces every number/series the guru page renders: greeks, fair value,
// payoff, probability, IV analysis, flow/positioning. Black-Scholes fills any
// greeks the data source didn't provide.

import { bsGreeks, bsPrice, normCdf, type Greeks, type OptType } from "./blackscholes";
import type { NormalizedChain, OptRow } from "./symbol";

const RISK_FREE = 0.04; // annual; good enough for short-dated decision support
const MIN_T = 1 / (365 * 24); // floor 1h so BS greeks don't blow up at 0DTE

// ── small helpers ───────────────────────────────────────────────────────────

function nearest(rows: OptRow[], strike: number): OptRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, r) =>
    Math.abs(r.strike - strike) < Math.abs(best.strike - strike) ? r : best
  );
}

function mid(row: OptRow): number {
  if (row.bid > 0 && row.ask > 0) return (row.bid + row.ask) / 2;
  return row.lastPrice > 0 ? row.lastPrice : Math.max(row.bid, row.ask, 0);
}

function spotRange(spot: number, pct = 0.35, n = 61): number[] {
  const lo = spot * (1 - pct);
  const hi = spot * (1 + pct);
  const step = (hi - lo) / (n - 1);
  return Array.from({ length: n }, (_, i) => lo + i * step);
}

// ── chain-level analytics ────────────────────────────────────────────────────

// ATM implied vol = IV of the strike nearest spot, averaging the call and put
// leg when both exist (smile is roughly symmetric at the money).
export function atmIV(chain: NormalizedChain): number {
  const c = nearest(chain.calls, chain.underlyingPrice);
  const p = nearest(chain.puts, chain.underlyingPrice);
  const ivs = [c?.impliedVolatility, p?.impliedVolatility].filter(
    (v): v is number => typeof v === "number" && v > 0
  );
  if (ivs.length === 0) return 0;
  return ivs.reduce((s, v) => s + v, 0) / ivs.length;
}

// Expected 1σ / 2σ move to expiry from ATM IV. Also the ATM-straddle move
// (model-free expected move) when both ATM legs are quoted.
export function expectedMove(chain: NormalizedChain, t: number) {
  const spot = chain.underlyingPrice;
  const iv = atmIV(chain);
  const oneSigma = spot * iv * Math.sqrt(Math.max(t, MIN_T));
  const c = nearest(chain.calls, spot);
  const p = nearest(chain.puts, spot);
  const straddle = c && p ? mid(c) + mid(p) : null;
  return {
    iv,
    pct: spot > 0 ? (oneSigma / spot) * 100 : 0,
    oneSigma,
    oneSigmaLo: spot - oneSigma,
    oneSigmaHi: spot + oneSigma,
    twoSigmaLo: spot - 2 * oneSigma,
    twoSigmaHi: spot + 2 * oneSigma,
    straddle, // total debit ≈ market-implied expected move in $
  };
}

// Put/call ratio on open interest and on volume. >1 = put-heavy (bearish/hedged).
export function putCallRatio(chain: NormalizedChain) {
  const sum = (rows: OptRow[], k: "openInterest" | "volume") =>
    rows.reduce((s, r) => s + (r[k] || 0), 0);
  const callOI = sum(chain.calls, "openInterest");
  const putOI = sum(chain.puts, "openInterest");
  const callVol = sum(chain.calls, "volume");
  const putVol = sum(chain.puts, "volume");
  return {
    oi: callOI > 0 ? putOI / callOI : 0,
    volume: callVol > 0 ? putVol / callVol : 0,
    callOI,
    putOI,
    callVol,
    putVol,
  };
}

// Max pain = strike that minimizes the total intrinsic value owed to all open
// option holders at expiry — where the most contracts expire worthless. Often a
// soft magnet into expiry.
export function maxPain(chain: NormalizedChain): number {
  const strikes = chain.strikes.length
    ? chain.strikes
    : Array.from(new Set([...chain.calls, ...chain.puts].map((o) => o.strike))).sort((a, b) => a - b);
  if (strikes.length === 0) return chain.underlyingPrice;
  let best = strikes[0];
  let bestPain = Infinity;
  for (const settle of strikes) {
    let pain = 0;
    for (const c of chain.calls) pain += Math.max(0, settle - c.strike) * (c.openInterest || 0);
    for (const p of chain.puts) pain += Math.max(0, p.strike - settle) * (p.openInterest || 0);
    if (pain < bestPain) {
      bestPain = pain;
      best = settle;
    }
  }
  return best;
}

// IV skew: implied vol of each call and put by strike (the volatility smile).
export function ivSkew(chain: NormalizedChain) {
  const byStrike = new Map<number, { strike: number; callIV: number | null; putIV: number | null }>();
  for (const c of chain.calls) {
    if (c.impliedVolatility > 0)
      byStrike.set(c.strike, { strike: c.strike, callIV: c.impliedVolatility * 100, putIV: null });
  }
  for (const p of chain.puts) {
    const e = byStrike.get(p.strike) ?? { strike: p.strike, callIV: null, putIV: null };
    if (p.impliedVolatility > 0) e.putIV = p.impliedVolatility * 100;
    byStrike.set(p.strike, e);
  }
  return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
}

// Open interest + volume per strike, split call/put, for the positioning chart.
export function oiByStrike(chain: NormalizedChain) {
  const byStrike = new Map<
    number,
    { strike: number; callOI: number; putOI: number; callVol: number; putVol: number }
  >();
  const ensure = (k: number) =>
    byStrike.get(k) ?? { strike: k, callOI: 0, putOI: 0, callVol: 0, putVol: 0 };
  for (const c of chain.calls) {
    const e = ensure(c.strike);
    e.callOI = c.openInterest || 0;
    e.callVol = c.volume || 0;
    byStrike.set(c.strike, e);
  }
  for (const p of chain.puts) {
    const e = ensure(p.strike);
    e.putOI = p.openInterest || 0;
    e.putVol = p.volume || 0;
    byStrike.set(p.strike, e);
  }
  return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
}

// IV vs realized (historical) vol → rich/cheap read. The percentile is a
// realized-vol-band PROXY (true IV-rank needs stored IV history).
export function ivVsHv(iv: number, hv: number) {
  const ratio = hv > 0 ? iv / hv : 0;
  const flag = ratio >= 1.2 ? "rich" : ratio <= 0.85 ? "cheap" : "fair";
  // Where IV sits within a plausible [0.5×, 2×] HV band → 0–100 proxy.
  const lo = hv * 0.5;
  const hi = hv * 2.0;
  const pctile = hi > lo ? Math.min(100, Math.max(0, ((iv - lo) / (hi - lo)) * 100)) : 50;
  return { ratio, flag, proxyPctile: pctile };
}

// ── per-contract analytics ───────────────────────────────────────────────────

export type ContractMetrics = {
  type: OptType;
  strike: number;
  premium: number; // mid (or last) per share/coin
  iv: number; // decimal
  fairValue: number; // BS theoretical
  edgePct: number; // (fair − premium)/premium × 100; +ve = underpriced vs BS
  greeks: Greeks;
  greeksSource: "native" | "blackscholes";
  intrinsic: number;
  extrinsic: number;
  breakeven: number;
  probITM: number; // %
  pop: number; // % probability of profit for a long single-leg hold to expiry
  maxLoss: number; // per contract (incl. multiplier)
  maxGain: number | null; // null = unlimited (long call)
  riskReward: number | null;
  spreadPct: number; // bid/ask spread as % of mid
  openInterest: number;
  volume: number;
  multiplier: number;
};

export function contractMetrics(
  chain: NormalizedChain,
  type: OptType,
  strike: number,
  t: number,
  hv: number,
  multiplier: number
): ContractMetrics | null {
  const rows = type === "C" ? chain.calls : chain.puts;
  const row = nearest(rows, strike);
  if (!row) return null;
  const S = chain.underlyingPrice;
  const K = row.strike;
  const tt = Math.max(t, MIN_T);
  const iv = row.impliedVolatility > 0 ? row.impliedVolatility : hv;
  const premium = mid(row) || bsPrice({ type, S, K, t: tt, r: RISK_FREE, sigma: iv });

  const greeks: Greeks = row.greeks
    ? { ...row.greeks, iv }
    : bsGreeks({ type, S, K, t: tt, r: RISK_FREE, sigma: iv });
  const greeksSource: "native" | "blackscholes" = row.greeks ? "native" : "blackscholes";

  const fairValue = bsPrice({ type, S, K, t: tt, r: RISK_FREE, sigma: iv });
  const intrinsic = type === "C" ? Math.max(0, S - K) : Math.max(0, K - S);
  const extrinsic = Math.max(0, premium - intrinsic);
  const breakeven = type === "C" ? K + premium : K - premium;

  // Risk-neutral prob of finishing ITM ≈ N(d2) for calls, N(−d2) for puts.
  const vsqrt = iv * Math.sqrt(tt);
  const d2 = (Math.log(S / K) + (RISK_FREE - 0.5 * iv * iv) * tt) / vsqrt;
  const probITM = (type === "C" ? normCdf(d2) : normCdf(-d2)) * 100;

  // Prob of profit for a long hold to expiry = P(S_T beyond breakeven).
  const dBE = (Math.log(S / breakeven) + (RISK_FREE - 0.5 * iv * iv) * tt) / vsqrt;
  const pop = (type === "C" ? normCdf(dBE) : normCdf(-dBE)) * 100;

  const maxLoss = premium * multiplier;
  const maxGain = type === "C" ? null : (K - premium) * multiplier; // long call = unlimited
  const riskReward = maxGain != null && maxLoss > 0 ? maxGain / maxLoss : null;

  const m = mid(row);
  const spreadPct = m > 0 && row.bid > 0 && row.ask > 0 ? ((row.ask - row.bid) / m) * 100 : 0;
  const edgePct = premium > 0 ? ((fairValue - premium) / premium) * 100 : 0;

  return {
    type,
    strike: K,
    premium,
    iv,
    fairValue,
    edgePct,
    greeks,
    greeksSource,
    intrinsic,
    extrinsic,
    breakeven,
    probITM,
    pop,
    maxLoss,
    maxGain,
    riskReward,
    spreadPct,
    openInterest: row.openInterest,
    volume: row.volume,
    multiplier,
  };
}

// ── chart series ─────────────────────────────────────────────────────────────

// P&L of a long single-leg position vs underlying: at expiry (intrinsic −
// premium) and right now (Black-Scholes mark − premium). Per contract.
export function payoffCurve(
  type: OptType,
  strike: number,
  premium: number,
  iv: number,
  t: number,
  spot: number,
  multiplier: number
) {
  const tt = Math.max(t, MIN_T);
  return spotRange(spot).map((price) => {
    const intrinsic = type === "C" ? Math.max(0, price - strike) : Math.max(0, strike - price);
    const nowVal = bsPrice({ type, S: price, K: strike, t: tt, r: RISK_FREE, sigma: iv });
    return {
      price: Number(price.toFixed(2)),
      expiry: Number(((intrinsic - premium) * multiplier).toFixed(2)),
      now: Number(((nowVal - premium) * multiplier).toFixed(2)),
    };
  });
}

// Greeks across the underlying range (how the position behaves as spot moves).
export function greeksProfile(type: OptType, strike: number, iv: number, t: number, spot: number) {
  const tt = Math.max(t, MIN_T);
  return spotRange(spot).map((price) => {
    const g = bsGreeks({ type, S: price, K: strike, t: tt, r: RISK_FREE, sigma: iv });
    return {
      price: Number(price.toFixed(2)),
      delta: Number(g.delta.toFixed(4)),
      gamma: Number(g.gamma.toFixed(5)),
      theta: Number(g.theta.toFixed(4)),
      vega: Number(g.vega.toFixed(4)),
    };
  });
}

// Lognormal terminal price distribution under risk-neutral drift — the
// probability cone. density is relative (for shading), not a strict pdf scale.
export function priceDistribution(spot: number, iv: number, t: number) {
  const tt = Math.max(t, MIN_T);
  const vsqrt = iv * Math.sqrt(tt);
  const drift = (RISK_FREE - 0.5 * iv * iv) * tt;
  return spotRange(spot, 0.6, 81).map((price) => {
    const z = (Math.log(price / spot) - drift) / vsqrt;
    const density = Math.exp(-0.5 * z * z) / (price * vsqrt); // lognormal pdf
    return { price: Number(price.toFixed(2)), density };
  });
}

// Expected-move cone widening to expiry, for overlaying on the price history.
export function coneBands(spot: number, iv: number, days: number) {
  const out: { day: number; lo1: number; hi1: number; lo2: number; hi2: number }[] = [];
  for (let d = 0; d <= days; d++) {
    const t = Math.max(d / 365, 0);
    const s1 = spot * iv * Math.sqrt(t);
    out.push({
      day: d,
      lo1: Number((spot - s1).toFixed(2)),
      hi1: Number((spot + s1).toFixed(2)),
      lo2: Number((spot - 2 * s1).toFixed(2)),
      hi2: Number((spot + 2 * s1).toFixed(2)),
    });
  }
  return out;
}

// ── top-level assembler ──────────────────────────────────────────────────────

export type TermPoint = { iso: string; dte: number; atmIV: number };

export type OptionsAnalysis = {
  source: "yahoo" | "deribit";
  underlying: string;
  spot: number;
  multiplier: number;
  expiryISO: string;
  dte: number;
  hv: number;
  expirations: { unix: number; iso: string }[];
  strikes: number[];
  selected: ContractMetrics | null;
  chainStats: {
    atmIV: number;
    ivVsHv: ReturnType<typeof ivVsHv>;
    putCall: ReturnType<typeof putCallRatio>;
    maxPain: number;
    expectedMove: ReturnType<typeof expectedMove>;
  };
  charts: {
    payoff: ReturnType<typeof payoffCurve>;
    greeks: ReturnType<typeof greeksProfile>;
    skew: ReturnType<typeof ivSkew>;
    oi: ReturnType<typeof oiByStrike>;
    distribution: ReturnType<typeof priceDistribution>;
    cone: ReturnType<typeof coneBands>;
    term: TermPoint[];
  };
};

function isoFromUnix(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

// Assemble the full analysis bundle from a normalized chain + selected leg.
export function buildOptionsAnalysis(args: {
  chain: NormalizedChain;
  type: OptType;
  strike: number;
  t: number; // years to expiry
  hv: number;
  multiplier: number;
  term?: TermPoint[];
}): OptionsAnalysis {
  const { chain, type, strike, t, hv, multiplier, term = [] } = args;
  const spot = chain.underlyingPrice;
  const selected = contractMetrics(chain, type, strike, t, hv, multiplier);
  const em = expectedMove(chain, t);
  const iv = selected?.iv ?? em.iv ?? hv;
  const dte = Math.max(0, Math.round(t * 365));

  return {
    source: chain.source,
    underlying: chain.underlying,
    spot,
    multiplier,
    expiryISO: isoFromUnix(chain.expiry),
    dte,
    hv,
    expirations: chain.expirations.map((u) => ({ unix: u, iso: isoFromUnix(u) })),
    strikes: chain.strikes,
    selected,
    chainStats: {
      atmIV: em.iv,
      ivVsHv: ivVsHv(em.iv || iv, hv),
      putCall: putCallRatio(chain),
      maxPain: maxPain(chain),
      expectedMove: em,
    },
    charts: {
      payoff: selected ? payoffCurve(type, selected.strike, selected.premium, iv, t, spot, multiplier) : [],
      greeks: selected ? greeksProfile(type, selected.strike, iv, t, spot) : [],
      skew: ivSkew(chain),
      oi: oiByStrike(chain),
      distribution: priceDistribution(spot, iv || hv, t),
      cone: coneBands(spot, iv || hv, Math.max(dte, 1)),
      term,
    },
  };
}
