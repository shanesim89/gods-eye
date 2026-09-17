import "server-only";
import type { ExchangeAdapter, Venue } from "./exchange";
import { OkxAdapter } from "./okx";

// Single venue: OKX V5 spot. HYPE trades there too (HYPE-USDT live on OKX
// as of 2026-09), so nothing routes to Hyperliquid anymore.
const okx = new OkxAdapter();

export function venueFor(_token: string): Venue {
  return "okx";
}

export function adapterFor(_token: string): ExchangeAdapter {
  return okx;
}
