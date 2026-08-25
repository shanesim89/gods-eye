// Deribit public options chain. No API key required.
// One call to get_book_summary_by_currency returns every live option's IV, OI,
// volume and bid/ask; the ticker endpoint adds native greeks for a single
// contract.
//
// Deribit runs TWO separate books per asset, and the difference matters:
//
//   "ETH"       coin-margined  — collateral, premium and settlement all in ETH.
//                               Quotes are denominated in the coin, so they get
//                               multiplied by underlying_price to reach USD.
//                               Deepest liquidity (~1.7M OI) but a short put
//                               here is NOT cash-secured: the margin is ETH, so
//                               you carry coin exposure on the collateral itself
//                               on top of the put's downside.
//   "ETH_USDC"  USDC-margined  — collateral and settlement in USDC. Quotes are
//                               ALREADY in USD; multiplying them would inflate
//                               every premium ~1,850×. Thinner (~2% of the coin
//                               book's OI) but genuinely cash-secured, which is
//                               what the wheel strategy actually assumes.
//
// Both are reachable here; deribit-chain.ts (the trading path) uses the USDC
// book, while load.ts's display/guru path stays on the deeper coin book.

import type { NormalizedChain, OptRow } from "./symbol";

const BASE = "https://www.deribit.com/api/v2/public";

// A tradable Deribit option book. The `_USDC` variants are USDC-margined.
export type DeribitBook = "BTC" | "ETH" | "BTC_USDC" | "ETH_USDC";

// USDC-margined instruments live under the shared `currency=USDC` book and are
// identified by their instrument-name prefix, not by their own currency code.
function bookApiCurrency(book: DeribitBook): string {
  return book.endsWith("_USDC") ? "USDC" : book;
}

// True when quotes come back denominated in the base coin (and so need
// converting to USD). USDC-margined books already quote in USD.
function isCoinQuoted(book: DeribitBook): boolean {
  return !book.endsWith("_USDC");
}

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

type BookRow = {
  instrument_name: string;
  mark_iv?: number; // percent, e.g. 76.56
  open_interest?: number; // in coin
  volume?: number; // in coin
  bid_price?: number | null; // in coin
  ask_price?: number | null; // in coin
  mark_price?: number | null; // in coin
  last?: number | null; // in coin
  underlying_price?: number;
};

type TickerResult = {
  mark_iv?: number;
  open_interest?: number;
  underlying_price?: number;
  greeks?: { delta: number; gamma: number; theta: number; vega: number };
};

// Parse "BTC-20JUN26-58000-C" → { expiryUnix, strike, type }. Deribit options
// expire at 08:00 UTC.
function parseInstrument(
  name: string
): { expiryUnix: number; strike: number; type: "C" | "P" } | null {
  const parts = name.split("-");
  if (parts.length !== 4) return null;
  const [, dateStr, strikeStr, cp] = parts;
  const m = dateStr.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const mon = MONTHS[m[2]];
  const year = 2000 + Number(m[3]);
  if (mon == null) return null;
  const expiryUnix = Math.floor(Date.UTC(year, mon, day, 8, 0, 0) / 1000);
  const strike = Number(strikeStr);
  if (!Number.isFinite(strike)) return null;
  return { expiryUnix, strike, type: cp === "C" ? "C" : "P" };
}

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Build a Deribit instrument name from parts, e.g. BTC-20JUN26-58000-C.
// Deribit uses no leading zero on the day.
export function buildDeribitInstrument(
  book: DeribitBook,
  expiryUnix: number,
  strike: number,
  type: "C" | "P"
): string {
  const d = new Date(expiryUnix * 1000);
  const day = d.getUTCDate();
  const mon = MONTH_NAMES[d.getUTCMonth()];
  const yy = String(d.getUTCFullYear()).slice(2);
  return `${book}-${day}${mon}${yy}-${strike}-${type}`;
}

async function deribitGet<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${path}`, {
      cache: "no-store",
      headers: { "User-Agent": "gods-eye/1.0" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: T };
    return j.result ?? null;
  } catch {
    return null;
  }
}

// ATM IV per expiry in ONE book-summary fetch (crypto term structure, cheap).
export async function getDeribitTermStructure(
  currency: "BTC" | "ETH"
): Promise<{ iso: string; dte: number; atmIV: number }[]> {
  const rows = await deribitGet<BookRow[]>(
    `/get_book_summary_by_currency?currency=${currency}&kind=option`
  );
  if (!rows || rows.length === 0) return [];
  const ups = rows
    .map((r) => r.underlying_price)
    .filter((p): p is number => typeof p === "number" && p > 0)
    .sort((a, b) => a - b);
  if (ups.length === 0) return [];
  const spot = ups[Math.floor(ups.length / 2)];
  const nowSec = Math.floor(Date.now() / 1000);

  // group rows by expiry, keep the strike nearest spot, average its IV
  const byExp = new Map<number, { bestDist: number; iv: number }>();
  for (const r of rows) {
    const p = parseInstrument(r.instrument_name);
    if (!p || p.expiryUnix <= nowSec || typeof r.mark_iv !== "number") continue;
    const dist = Math.abs(p.strike - spot);
    const cur = byExp.get(p.expiryUnix);
    if (!cur || dist < cur.bestDist) byExp.set(p.expiryUnix, { bestDist: dist, iv: r.mark_iv / 100 });
  }
  return Array.from(byExp.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, 8)
    .map(([unix, v]) => ({
      iso: new Date(unix * 1000).toISOString().slice(0, 10),
      dte: Math.max(0, Math.round((unix - nowSec) / 86400)),
      atmIV: v.iv,
    }));
}

// Native greeks + IV + OI for one contract. Returned greeks are per-coin; the
// caller already works in USD-normalized weights so we surface them as-is for
// the contract summary (delta is unitless, the rest are small per-coin numbers).
export async function getDeribitTicker(instrument: string): Promise<TickerResult | null> {
  return deribitGet<TickerResult>(`/ticker?instrument_name=${encodeURIComponent(instrument)}`);
}

// Full chain for BTC or ETH. When expiryUnix is omitted, selects the nearest
// future expiry. Coin-denominated quotes are converted to USD.
export async function getDeribitChain(
  book: DeribitBook,
  expiryUnix?: number
): Promise<NormalizedChain | null> {
  const all = await deribitGet<BookRow[]>(
    `/get_book_summary_by_currency?currency=${bookApiCurrency(book)}&kind=option`
  );
  if (!all || all.length === 0) return null;

  // The USDC book is shared across assets (BTC_USDC, ETH_USDC, SOL_USDC, …) —
  // narrow to this one by instrument-name prefix. Coin books are already
  // single-asset, but the same filter is harmless there.
  const rows = all.filter((r) => r.instrument_name.startsWith(`${book}-`));
  if (rows.length === 0) return null;

  // Underlying price: median of reported underlying_price (robust to a few zeros).
  const ups = rows
    .map((r) => r.underlying_price)
    .filter((p): p is number => typeof p === "number" && p > 0)
    .sort((a, b) => a - b);
  if (ups.length === 0) return null;
  const underlyingPrice = ups[Math.floor(ups.length / 2)];

  type Parsed = BookRow & { _exp: number; _strike: number; _type: "C" | "P" };
  const parsed: Parsed[] = [];
  for (const r of rows) {
    const p = parseInstrument(r.instrument_name);
    if (!p) continue;
    parsed.push({ ...r, _exp: p.expiryUnix, _strike: p.strike, _type: p.type });
  }
  if (parsed.length === 0) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const expirations = Array.from(new Set(parsed.map((p) => p._exp)))
    .filter((e) => e > nowSec)
    .sort((a, b) => a - b);
  if (expirations.length === 0) return null;

  const target =
    expiryUnix && expirations.includes(expiryUnix) ? expiryUnix : expirations[0];

  // Coin-margined books quote in the base coin; USDC-margined books already
  // quote in USD. Multiplying the latter would inflate every premium ~1,850×.
  const coinQuoted = isCoinQuoted(book);
  const toUsd = (px: number | null | undefined): number =>
    typeof px === "number" && px > 0 ? (coinQuoted ? px * underlyingPrice : px) : 0;

  const toRow = (p: Parsed): OptRow => {
    const last = p.last ?? p.mark_price ?? 0;
    const iv = typeof p.mark_iv === "number" ? p.mark_iv / 100 : 0;
    return {
      strike: p._strike,
      lastPrice: toUsd(last),
      bid: toUsd(p.bid_price),
      ask: toUsd(p.ask_price),
      volume: p.volume ?? 0,
      openInterest: p.open_interest ?? 0,
      impliedVolatility: iv,
      inTheMoney:
        p._type === "C" ? p._strike < underlyingPrice : p._strike > underlyingPrice,
      greeks: null,
    };
  };

  const forExpiry = parsed.filter((p) => p._exp === target);
  const calls = forExpiry.filter((p) => p._type === "C").map(toRow).sort((a, b) => a.strike - b.strike);
  const puts = forExpiry.filter((p) => p._type === "P").map(toRow).sort((a, b) => a.strike - b.strike);
  const strikes = Array.from(new Set(forExpiry.map((p) => p._strike))).sort((a, b) => a - b);

  return {
    source: "deribit",
    underlying: book,
    underlyingPrice,
    expiry: target,
    expirations,
    strikes,
    calls,
    puts,
  };
}
