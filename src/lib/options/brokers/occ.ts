// OCC option-symbol mapping — the internal contract_symbol format
// (wheel-chain.ts's mkContractSymbol / strategy.ts's mkContractSymbol, e.g.
// "SPY-260117P00500000" — dash-separated, no strike scaling) is NOT real OCC
// format. Verified against Alpaca's live /v2/options/contracts on the paper
// account 2026-07-15: real symbols are root+YYMMDD+C|P+strike*1000 padded to
// 8 digits, no separators, no root padding (e.g. "SPY260714C00500000").
// Any broker call MUST go through toOccSymbol — never pass the internal
// contract_symbol straight through.

export function toOccSymbol(underlying: string, expiry: Date, type: "C" | "P", strike: number): string {
  const yy = String(expiry.getUTCFullYear()).slice(2);
  const mm = String(expiry.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(expiry.getUTCDate()).padStart(2, "0");
  const strikeCode = Math.round(strike * 1000).toString().padStart(8, "0");
  return `${underlying.toUpperCase()}${yy}${mm}${dd}${type}${strikeCode}`;
}

export type ParsedOccSymbol = { underlying: string; expiry: Date; type: "C" | "P"; strike: number };

// Root symbols can contain digits/letters but never C/P followed by exactly 8
// digits at the tail — anchor on that fixed-width suffix instead of guessing
// where the root ends (roots vary 1-6 chars, unpadded on Alpaca).
const OCC_RE = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function parseOccSymbol(symbol: string): ParsedOccSymbol | null {
  const m = OCC_RE.exec(symbol.toUpperCase());
  if (!m) return null;
  const [, underlying, yy, mm, dd, type, strikeCode] = m;
  const expiry = new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd)));
  return { underlying, expiry, type: type as "C" | "P", strike: Number(strikeCode) / 1000 };
}
