// Broker adapter interface — the seam between the paper-trading engine
// (engine.ts, strategy.ts) and a real execution venue. engine.ts branches on
// `!settings.paper` to call a real adapter (AlpacaBroker) instead of
// `settle()`-ing a simulated fill; this is the shape that implements against.
//
// Live-readiness milestone 1 (broker_adapter) — see scripts/live-readiness-state.json.

export type BrokerOrderSide = "buy_to_open" | "sell_to_open" | "buy_to_close" | "sell_to_close";

export type BrokerOptionOrder = {
  contractSymbol: string; // MUST be real OCC format (occ.ts toOccSymbol) — NOT the internal
  // dash-separated contract_symbol used elsewhere in this codebase (strategy.ts/wheel-chain.ts).
  // e.g. "SPY260117P00500000", not "SPY-260117P00500000".
  side: BrokerOrderSide;
  contracts: number;
  limitPrice?: number; // omit for market
};

export type BrokerOrderResult = {
  brokerOrderId: string;
  status: "filled" | "partially_filled" | "pending" | "rejected";
  filledPrice?: number;
  filledContracts?: number;
};

export type BrokerAccount = {
  cashUsd: number;
  buyingPowerUsd: number;
  equityUsd: number;
};

export type BrokerPosition = {
  contractSymbol: string;
  contracts: number; // negative = short
  avgEntryPrice: number;
};

// Options assignment/exercise/expiration events — the ground truth for what
// actually happened to a short option, used instead of comparing our own
// spot-price snapshot to the strike (assignment_handling milestone). "OPASN"
// = assigned/exercised, "OPEXP" = expired worthless (Alpaca's own taxonomy;
// kept as the raw string here since the caller already knows which strategy
// the contract belongs to and can interpret OPASN correctly for a put vs a
// call without needing a separate enum).
export type BrokerActivity = {
  contractSymbol: string;
  activityType: string;
  date: string; // YYYY-MM-DD
  qty: number;
};

export interface OptionsBroker {
  getAccount(): Promise<BrokerAccount>;
  getPositions(): Promise<BrokerPosition[]>;
  placeOrder(order: BrokerOptionOrder): Promise<BrokerOrderResult>;
  cancelOrder(brokerOrderId: string): Promise<void>; // used to clean up a placeOrder() that didn't fill
  cancelAllOrders(): Promise<void>; // used by the live kill-switch path
  getOptionActivities(sinceDays?: number): Promise<BrokerActivity[]>;
}
