import "server-only";
import { getYahooData, getYahooOptions } from "@/lib/yahoo";
import { getPriceHistory } from "@/lib/market";
import {
  getDeribitChain,
  getDeribitTermStructure,
  getDeribitTicker,
  buildDeribitInstrument,
} from "./deribit";
import { buildOptionsAnalysis, atmIV, type OptionsAnalysis, type TermPoint } from "./analytics";
import { histVol, yearsTo, type OptType } from "./blackscholes";
import { parseContract, isCryptoUnderlying, type NormalizedChain } from "./symbol";

const EQUITY_MULTIPLIER = 100; // 1 US equity option = 100 shares
const CRYPTO_MULTIPLIER = 1; // 1 Deribit option = 1 coin

export type LoadResult =
  | { ok: true; analysis: OptionsAnalysis }
  | { ok: false; error: string; underlying: string; crypto: boolean };

export type SelectParams = { exp?: number; strike?: number; type?: OptType };

function nearestStrike(strikes: number[], target: number): number {
  if (strikes.length === 0) return target;
  return strikes.reduce((b, s) => (Math.abs(s - target) < Math.abs(b - target) ? s : b));
}

// Single source of truth for the options page + API route: fetch the chain
// (Yahoo or Deribit), resolve the selected leg, compute HV, pull native greeks
// for crypto, build the term structure, and assemble the full analysis bundle.
export async function loadOptionsAnalysis(
  rawTicker: string,
  sel: SelectParams = {}
): Promise<LoadResult> {
  const parsed = parseContract(rawTicker);
  const crypto = isCryptoUnderlying(parsed.underlying);
  const multiplier = crypto ? CRYPTO_MULTIPLIER : EQUITY_MULTIPLIER;

  const fetchChain = (exp?: number) =>
    crypto
      ? getDeribitChain(parsed.underlying as "BTC" | "ETH", exp)
      : getYahooOptions(parsed.underlying, exp);

  // 1. Chain at the requested (or nearest) expiry.
  let chain = await fetchChain(sel.exp);

  // No explicit expiry but a dated contract → snap to the nearest listed expiry.
  if (!sel.exp && parsed.isContract && parsed.expiry && chain && chain.expirations.length) {
    const want = Math.floor(parsed.expiry.getTime() / 1000);
    const snap = chain.expirations.reduce((b, e) => (Math.abs(e - want) < Math.abs(b - want) ? e : b));
    if (snap !== chain.expiry) chain = await fetchChain(snap);
  }

  // No explicit expiry and bare ticker → skip 0DTE; default to first expiry ≥ 7 DTE.
  if (!sel.exp && !parsed.isContract && chain && chain.expirations.length) {
    const nowSec = Math.floor(Date.now() / 1000);
    const sevenDaySec = 7 * 86400;
    const snap = chain.expirations.find((e) => e - nowSec >= sevenDaySec) ?? chain.expirations[0];
    if (snap !== chain.expiry) chain = await fetchChain(snap);
  }

  if (!chain || (chain.calls.length === 0 && chain.puts.length === 0)) {
    return { ok: false, error: `No option chain for ${parsed.underlying}`, underlying: parsed.underlying, crypto };
  }

  // 2. Selected leg: query → contract → ATM call default.
  const type: OptType = sel.type ?? parsed.optionType ?? "C";
  const strike = sel.strike ?? parsed.strike ?? nearestStrike(chain.strikes, chain.underlyingPrice);

  // 3. Historical vol for IV/HV read + greeks fallback.
  const closes = crypto
    ? await getPriceHistory(parsed.underlying, 120)
    : (await getYahooData(parsed.underlying, 120))?.candles?.c ?? null;
  const hv = histVol(closes, 0.4);

  // 4. Native greeks for the selected crypto contract.
  if (crypto) {
    const inst = buildDeribitInstrument(parsed.underlying as "BTC" | "ETH", chain.expiry, strike, type);
    const tk = await getDeribitTicker(inst);
    if (tk?.greeks) {
      const rows = type === "C" ? chain.calls : chain.puts;
      const target = rows.reduce(
        (b, r) => (Math.abs(r.strike - strike) < Math.abs(b.strike - strike) ? r : b),
        rows[0]
      );
      if (target) target.greeks = tk.greeks;
    }
  }

  // 5. Time to expiry.
  const t = yearsTo(new Date(chain.expiry * 1000));

  // 6. Term structure (ATM IV vs DTE).
  let term: TermPoint[] = [];
  try {
    if (crypto) {
      term = await getDeribitTermStructure(parsed.underlying as "BTC" | "ETH");
    } else {
      const chains = await Promise.all(chain.expirations.slice(0, 6).map((e) => getYahooOptions(parsed.underlying, e)));
      const now = Date.now();
      term = chains
        .filter((c): c is NormalizedChain => !!c)
        .map((c) => ({
          iso: new Date(c.expiry * 1000).toISOString().slice(0, 10),
          dte: Math.max(0, Math.round((c.expiry * 1000 - now) / 86_400_000)),
          atmIV: atmIV(c),
        }))
        .filter((p) => p.atmIV > 0);
    }
  } catch {
    term = [];
  }

  const analysis = buildOptionsAnalysis({ chain, type, strike, t, hv, multiplier, term });
  return { ok: true, analysis };
}
