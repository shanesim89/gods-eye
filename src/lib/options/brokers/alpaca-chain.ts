import "server-only";
import { bsGreeks, strikeForDelta, roundStrike, yearsTo, type Greeks } from "../blackscholes";
import { adjustCCDeltaForVerdict } from "../strategy";

// Real-chain pricing via Alpaca's own options data — same role as
// wheel-chain.ts's fetchRealCSPQuote (Yahoo), but sourced from the broker
// we'll actually execute against. Two separate Alpaca hosts: /v2/options/contracts
// lives on the trading API (paper-api.alpaca.markets), quotes live on the data
// API (data.alpaca.markets) — confirmed live 2026-07-15 against the paper account.
//
// KNOWN GAP: Alpaca's indicative feed (free tier) does not return per-contract
// implied vol on the quotes endpoint, unlike Yahoo. Greeks here are computed
// with the CALLER-SUPPLIED sigma (historical vol), not chain IV — same
// approximation load.ts/engine.ts already make for the crypto (Deribit-less)
// path today. Upgrading to OPRA feed (paid) would fix this; not required to
// reach paper-trading parity.

const TRADING_BASE = "https://paper-api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";

function headers(): Record<string, string> {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secret) throw new Error("ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY not set");
  return { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret };
}

type AlpacaContract = {
  symbol: string;
  strike_price: string;
  expiration_date: string;
  open_interest: string | null;
};

async function listContracts(
  underlying: string,
  optType: "C" | "P",
  dteMin: number,
  dteMax: number,
  strikeLo: number,
  strikeHi: number,
  now: Date
): Promise<AlpacaContract[]> {
  const gte = new Date(now.getTime() + dteMin * 86_400_000).toISOString().slice(0, 10);
  const lte = new Date(now.getTime() + dteMax * 86_400_000).toISOString().slice(0, 10);
  const url =
    `${TRADING_BASE}/v2/options/contracts?underlying_symbols=${encodeURIComponent(underlying)}` +
    `&type=${optType === "P" ? "put" : "call"}&status=active` +
    `&expiration_date_gte=${gte}&expiration_date_lte=${lte}` +
    `&strike_price_gte=${strikeLo.toFixed(2)}&strike_price_lte=${strikeHi.toFixed(2)}&limit=100`;
  const r = await fetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [];
  const j = (await r.json()) as { option_contracts?: AlpacaContract[] };
  return j.option_contracts ?? [];
}

type AlpacaQuote = { bp?: number; ap?: number; bs?: number; as?: number };

async function getQuotes(symbols: string[]): Promise<Record<string, AlpacaQuote>> {
  if (symbols.length === 0) return {};
  const url = `${DATA_BASE}/v1beta1/options/quotes/latest?symbols=${symbols.map(encodeURIComponent).join(",")}&feed=indicative`;
  const r = await fetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!r.ok) return {};
  const j = (await r.json()) as { quotes?: Record<string, AlpacaQuote> };
  return j.quotes ?? {};
}

export type AlpacaLegQuote = {
  strike: number;
  expiry: Date;
  dte: number;
  bid: number;
  ask: number;
  premium: number; // = bid, conservative fill for a sale
  greeks: Greeks;
  openInterest: number;
  contractSymbol: string; // real OCC
};

async function fetchAlpacaLeg(
  underlying: string,
  optType: "C" | "P",
  targetStrike: number,
  spot: number,
  sigma: number,
  dteMin: number,
  dteMax: number,
  riskFreeRate: number,
  now: Date,
  strikeFilter: (strike: number) => boolean,
  minOpenInterest = 50
): Promise<AlpacaLegQuote | null> {
  const band = spot * 0.25;
  const contracts = await listContracts(underlying, optType, dteMin, dteMax, spot - band, spot + band, now);
  const candidates = contracts.filter((c) => strikeFilter(Number(c.strike_price)));
  if (candidates.length === 0) return null;
  const nearest = candidates.reduce((best, c) =>
    Math.abs(Number(c.strike_price) - targetStrike) < Math.abs(Number(best.strike_price) - targetStrike) ? c : best
  );
  const oi = Number(nearest.open_interest ?? 0);
  if (oi < minOpenInterest) return null;

  const quotes = await getQuotes([nearest.symbol]);
  const q = quotes[nearest.symbol];
  if (!q || !q.bp || q.bp <= 0) return null; // unfillable at a real bid

  const expiry = new Date(`${nearest.expiration_date}T21:00:00Z`);
  const dte = Math.round((expiry.getTime() - now.getTime()) / 86_400_000);
  const t = yearsTo(expiry, now);
  const strike = Number(nearest.strike_price);
  const greeks = bsGreeks({ type: optType, S: spot, K: strike, t, r: riskFreeRate, sigma });

  return {
    strike,
    expiry,
    dte,
    bid: q.bp,
    ask: q.ap ?? q.bp,
    premium: q.bp,
    greeks,
    openInterest: oi,
    contractSymbol: nearest.symbol,
  };
}

// Cash-secured put — same Δ-target math as wheel-chain.ts's fetchRealCSPQuote,
// snapped to a real Alpaca-listed put with a real bid.
export async function fetchAlpacaCSPQuote(
  underlying: string,
  spot: number,
  sigma: number,
  cfg: { targetDelta: number; dteMin: number; dteMax: number; riskFreeRate: number },
  now = new Date()
): Promise<AlpacaLegQuote | null> {
  const approxT = (cfg.dteMin + cfg.dteMax) / 2 / 365;
  const rawK = strikeForDelta(cfg.targetDelta / 100, "P", spot, approxT, cfg.riskFreeRate, sigma);
  let targetStrike = roundStrike(Math.min(rawK, spot));
  if (targetStrike >= spot) targetStrike = roundStrike(spot * 0.99);
  return fetchAlpacaLeg(underlying, "P", targetStrike, spot, sigma, cfg.dteMin, cfg.dteMax, cfg.riskFreeRate, now, (k) => k < spot);
}

// Covered call — same floor (never below cost basis) AND same council-verdict
// delta adjustment (lever 2, adjustCCDeltaForVerdict) as wheel-chain.ts's
// fetchRealCCQuote — living wiring must not lose that improvement.
export async function fetchAlpacaCCQuote(
  underlying: string,
  spot: number,
  costBasis: number,
  sigma: number,
  cfg: { targetDelta: number; dteMin: number; dteMax: number; riskFreeRate: number; convictionThreshold: number },
  now = new Date(),
  verdict?: "BUY" | "HOLD" | "SELL",
  confidence?: number
): Promise<AlpacaLegQuote | null> {
  const effectiveDelta = adjustCCDeltaForVerdict(cfg.targetDelta, verdict, confidence, cfg.convictionThreshold);
  const approxT = (cfg.dteMin + cfg.dteMax) / 2 / 365;
  const rawK = strikeForDelta(effectiveDelta / 100, "C", spot, approxT, cfg.riskFreeRate, sigma);
  const floor = Math.max(costBasis, spot);
  const targetStrike = roundStrike(Math.max(rawK, floor));
  return fetchAlpacaLeg(underlying, "C", targetStrike, spot, sigma, cfg.dteMin, cfg.dteMax, cfg.riskFreeRate, now, (k) => k >= floor);
}
