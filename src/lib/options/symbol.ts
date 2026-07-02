// Shared option-contract notation parsing + the source-agnostic chain shape.
// Contract notation used across the guru routes: UNDERLYING-YYMMDD[C|P]STRIKE
//   e.g. SPY-250620C500, TQQQ-251219P40, BTC-260626C60000
// Equities/ETFs resolve to a Yahoo chain; BTC/ETH resolve to a Deribit chain.
// Both fetchers normalize to NormalizedChain so analytics + UI never branch on
// the data source.

import type { OptType } from "./blackscholes";

// One option contract row, identical shape from Yahoo and Deribit. Premiums and
// bid/ask are in USD per share/coin (Deribit's coin-denominated quotes are
// converted upstream).
export type OptRow = {
  strike: number;
  lastPrice: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number; // annualized decimal, e.g. 0.55
  inTheMoney: boolean;
  // Native greeks when the source provides them (Deribit). null → caller fills
  // via Black-Scholes from impliedVolatility.
  greeks?: { delta: number; gamma: number; theta: number; vega: number } | null;
};

// A chain for a single expiry plus the list of all available expiries/strikes
// so the picker can offer alternatives without another round-trip.
export type NormalizedChain = {
  source: "yahoo" | "deribit";
  underlying: string;
  underlyingPrice: number;
  expiry: number; // unix seconds of the selected expiry
  expirations: number[]; // unix seconds, ascending
  strikes: number[]; // strikes available for the selected expiry, ascending
  calls: OptRow[];
  puts: OptRow[];
};

export type ParsedContract = {
  raw: string;
  underlying: string;
  isContract: boolean; // true when the full UNDERLYING-YYMMDD[C|P]STRIKE matched
  optionType: OptType | null;
  strike: number | null;
  expiry: Date | null; // expiry at 21:00 UTC (US close ≈ options settlement)
  expiryISO: string | null; // YYYY-MM-DD
  isCrypto: boolean;
};

const CONTRACT_RE = /^([A-Z]+)-(\d{6})([CP])(\d+(?:\.\d+)?)$/;
const CRYPTO_UNDERLYINGS = new Set(["BTC", "ETH"]);

export function isCryptoUnderlying(underlying: string): boolean {
  return CRYPTO_UNDERLYINGS.has(underlying.toUpperCase());
}

// Parse UNDERLYING-YYMMDD[C|P]STRIKE. When only a bare underlying is supplied
// (e.g. "SPY"), returns isContract=false with the rest null so the caller can
// default to the nearest expiry + ATM strike.
export function parseContract(symbol: string): ParsedContract {
  const raw = symbol.toUpperCase().trim();
  const m = raw.match(CONTRACT_RE);
  if (!m) {
    return {
      raw,
      underlying: raw,
      isContract: false,
      optionType: null,
      strike: null,
      expiry: null,
      expiryISO: null,
      isCrypto: isCryptoUnderlying(raw),
    };
  }
  const underlying = m[1];
  const yy = m[2].slice(0, 2);
  const mm = m[2].slice(2, 4);
  const dd = m[2].slice(4, 6);
  const expiryISO = `20${yy}-${mm}-${dd}`;
  // Settle/expire at 21:00 UTC — close enough to both US equity close and
  // Deribit's 08:00 UTC expiry for time-to-expiry math at daily granularity.
  const expiry = new Date(`${expiryISO}T21:00:00Z`);
  return {
    raw,
    underlying,
    isContract: true,
    optionType: m[3] as OptType,
    strike: Number(m[4]),
    expiry: Number.isNaN(expiry.getTime()) ? null : expiry,
    expiryISO,
    isCrypto: isCryptoUnderlying(underlying),
  };
}

// Build canonical contract notation from parts (for links / picker round-trips).
export function buildContractSymbol(
  underlying: string,
  expiry: Date,
  type: OptType,
  strike: number
): string {
  const yy = String(expiry.getUTCFullYear()).slice(2);
  const mm = String(expiry.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(expiry.getUTCDate()).padStart(2, "0");
  // Drop a trailing .0 so strikes read cleanly (500 not 500.0).
  const k = Number.isInteger(strike) ? String(strike) : String(strike);
  return `${underlying.toUpperCase()}-${yy}${mm}${dd}${type}${k}`;
}
