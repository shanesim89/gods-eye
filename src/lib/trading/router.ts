import "server-only";
import type { ExchangeAdapter, Venue } from "./exchange";
import { HyperliquidAdapter } from "./hyperliquid";
import { OkxAdapter } from "./okx";

// Venue routing by asset. Hyperliquid spot only lists its native token (HYPE)
// among our universe; the major coins (BTC/ETH/SOL) are not on HL spot, so they
// route to OKX V5 spot instead.
const hyperliquid = new HyperliquidAdapter();
const okx = new OkxAdapter();

// Tokens that trade on Hyperliquid spot. Everything else → OKX.
const HL_SPOT = new Set(["HYPE"]);

export function venueFor(token: string): Venue {
  return HL_SPOT.has(token.toUpperCase()) ? "hyperliquid" : "okx";
}

export function adapterFor(token: string): ExchangeAdapter {
  return HL_SPOT.has(token.toUpperCase()) ? hyperliquid : okx;
}
