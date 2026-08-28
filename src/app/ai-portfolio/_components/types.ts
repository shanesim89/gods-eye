// Shared shapes for the live "what the bot sees" dashboard components.

export type Bar = {
  t: number; // epoch seconds
  o: number;
  h: number;
  l: number;
  c: number;
  vwap: number | null;
};

export type Observing = {
  symbol?: string;
  timeframe?: string;
  feed?: string;
  price?: number | null;
  vwap?: number | null;
  stretch?: number | null;
  session_open?: boolean;
  regime?: string;
};

export type TradeRow = {
  exit: string;
  side: "LONG" | "SHORT";
  entry: number;
  exit_px: number;
  entry_ts?: number | null;
  exit_ts?: number | null;
  pnl: number;
  stretch: number;
  reason?: string;
};

export type OpenPos = {
  direction: number;
  entry: number;
  size: number;
  stretch: number;
};

export type Session = {
  trades: number;
  win_rate: number | null;
  profit_factor: number | null;
  pnl: number;
};

