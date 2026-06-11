// Black-Scholes option pricing + Greeks. Pure, dependency-free.
// Used by the paper-trading options engine to price contracts from the
// underlying spot price + a historical-volatility IV estimate. No live
// option chain needed — fully self-contained. Live IV feed is a future upgrade.

export type OptType = "C" | "P";

export type BsInput = {
  type: OptType;
  S: number; // spot
  K: number; // strike
  t: number; // years to expiry
  r: number; // risk-free rate (annual, decimal)
  sigma: number; // implied vol (annual, decimal)
};

export type Greeks = {
  delta: number;
  gamma: number;
  theta: number; // per day
  vega: number; // per 1 vol point (0.01)
  iv: number;
};

const YEAR_DAYS = 365;

// Standard normal PDF.
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Standard normal CDF — Abramowitz & Stegun 7.1.26 approximation.
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const tt = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * tt - 1.453152027) * tt + 1.421413741) * tt - 0.284496736) * tt +
      0.254829592) *
      tt *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

function d1d2({ S, K, t, r, sigma }: Omit<BsInput, "type">): { d1: number; d2: number } {
  const vsqrt = sigma * Math.sqrt(t);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * t) / vsqrt;
  const d2 = d1 - vsqrt;
  return { d1, d2 };
}

// Premium per share. Guards against t≤0 / sigma≤0 by returning intrinsic value.
export function bsPrice(inp: BsInput): number {
  const { type, S, K, t, r, sigma } = inp;
  if (t <= 0 || sigma <= 0) {
    return type === "C" ? Math.max(0, S - K) : Math.max(0, K - S);
  }
  const { d1, d2 } = d1d2(inp);
  const disc = Math.exp(-r * t);
  if (type === "C") return S * normCdf(d1) - K * disc * normCdf(d2);
  return K * disc * normCdf(-d2) - S * normCdf(-d1);
}

export function bsGreeks(inp: BsInput): Greeks {
  const { type, S, K, t, r, sigma } = inp;
  if (t <= 0 || sigma <= 0) {
    const intrinsicDelta = type === "C" ? (S > K ? 1 : 0) : S < K ? -1 : 0;
    return { delta: intrinsicDelta, gamma: 0, theta: 0, vega: 0, iv: sigma };
  }
  const { d1, d2 } = d1d2(inp);
  const disc = Math.exp(-r * t);
  const pdf = normPdf(d1);
  const delta = type === "C" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * sigma * Math.sqrt(t));
  const vega = (S * pdf * Math.sqrt(t)) / 100; // per 1 vol point
  const thetaAnnual =
    type === "C"
      ? -(S * pdf * sigma) / (2 * Math.sqrt(t)) - r * K * disc * normCdf(d2)
      : -(S * pdf * sigma) / (2 * Math.sqrt(t)) + r * K * disc * normCdf(-d2);
  return { delta, gamma, theta: thetaAnnual / YEAR_DAYS, vega, iv: sigma };
}

// Annualized volatility from a daily close series (IV proxy).
// Falls back to a sane default when the series is too short.
export function histVol(series: number[] | null | undefined, fallback = 0.4): number {
  if (!series || series.length < 5) return fallback;
  const rets: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 4) return fallback;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
  const daily = Math.sqrt(variance);
  const annual = daily * Math.sqrt(YEAR_DAYS);
  if (!Number.isFinite(annual) || annual <= 0) return fallback;
  // clamp to a believable band
  return Math.min(2.5, Math.max(0.1, annual));
}

// Solve for the strike whose |delta| ≈ targetDelta (e.g. 0.30) via bisection.
// For puts targetDelta is given as a positive magnitude.
export function strikeForDelta(
  targetDelta: number,
  type: OptType,
  S: number,
  t: number,
  r: number,
  sigma: number
): number {
  const target = Math.abs(targetDelta);
  // OTM direction: calls above spot, puts below spot.
  let lo = type === "C" ? S : S * 0.3;
  let hi = type === "C" ? S * 3 : S;
  // deltaAt returns |delta| for a given strike (monotonic in K)
  const deltaAt = (K: number) => Math.abs(bsGreeks({ type, S, K, t, r, sigma }).delta);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const d = deltaAt(mid);
    // |delta| decreases as strike moves further OTM (K up for calls, K down for puts)
    if (type === "C") {
      if (d > target) lo = mid;
      else hi = mid;
    } else {
      if (d > target) hi = mid;
      else lo = mid;
    }
  }
  return (lo + hi) / 2;
}

// Round a strike to a sensible increment for display/realism.
export function roundStrike(K: number): number {
  if (K >= 1000) return Math.round(K / 5) * 5;
  if (K >= 100) return Math.round(K);
  if (K >= 25) return Math.round(K * 2) / 2;
  return Math.round(K * 10) / 10;
}

// Years between now and an expiry date (floored at a tiny positive).
export function yearsTo(expiry: Date, now = new Date()): number {
  const ms = expiry.getTime() - now.getTime();
  return Math.max(1 / (YEAR_DAYS * 24), ms / (YEAR_DAYS * 86_400_000));
}
