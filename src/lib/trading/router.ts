import "server-only";
import type { ExchangeAdapter, Venue } from "./exchange";
import { HyperliquidAdapter } from "./hyperliquid";

// All tokens routed through Hyperliquid spot.
const hyperliquid = new HyperliquidAdapter();

export function venueFor(_token: string): Venue {
  return "hyperliquid";
}

export function adapterFor(_token: string): ExchangeAdapter {
  return hyperliquid;
}
