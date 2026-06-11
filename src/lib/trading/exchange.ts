import "server-only";

export type Venue = "okx" | "hyperliquid" | "binance";

export type MarketBuyResult = {
  orderId: string;
  qty: number;     // base-asset quantity filled
  price: number;   // avg fill price in USD
};

// Common interface every venue adapter implements.
export interface ExchangeAdapter {
  readonly venue: Venue;
  // Quote-currency (USD/USDT/USDC) balance available to spend.
  getUsdBalance(): Promise<number>;
  // Spot price of token in USD.
  getPrice(token: string): Promise<number>;
  // Market buy of `usdAmount` notional. Throws on any failure.
  marketBuy(token: string, usdAmount: number): Promise<MarketBuyResult>;
}

export class ExchangeError extends Error {
  constructor(public venue: Venue, message: string) {
    super(`[${venue}] ${message}`);
    this.name = "ExchangeError";
  }
}
