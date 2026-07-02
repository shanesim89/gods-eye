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

export type PDHLBar = {
  t: number; // epoch seconds
  o: number;
  h: number;
  l: number;
  c: number;
  pdh: number | null;
  pdl: number | null;
};

export type PDHLObserving = {
  symbol?: string;
  timeframe?: string;
  period?: string; // "daily" | "8h" | "4h"
  feed?: string;
  price?: number | null;
  pdh?: number | null;
  pdl?: number | null;
  break_state?: "idle" | "broke_high" | "broke_low";
  session_open?: boolean;
};

export type PDHLTradeRow = {
  exit: string;
  side: "LONG" | "SHORT";
  entry: number;
  exit_px: number;
  entry_ts?: number | null;
  exit_ts?: number | null;
  level: number;
  pnl: number;
  reason?: string;
};

export type PDHLOpenPos = {
  direction: number;
  entry: number;
  level: number;
  size: number;
  remaining?: number;
  tp1_done?: boolean;
};

export type PDHLOverallStats = {
  trades?: number;
  win_rate?: number;
  profit_factor?: number;
  expectancy_R?: number;
  total_pnl?: number;
  return_pct?: number;
  max_dd_pct?: number;
  sharpe_ann?: number;
  skips?: Record<string, number>;
};

export type PDHLState = {
  stage: string;
  version?: string;
  strategy: string;
  equity: number;
  starting_balance: number;
  circuit_state?: string;
  open_position?: PDHLOpenPos | null;
  session?: Session;
  gates?: {
    research?: string;
    paper?: string;
    live?: string;
    overall_paper?: PDHLOverallStats;
  };
  history?: { date: string; equity: number }[];
  recent_trades?: PDHLTradeRow[];
  recent_bars?: PDHLBar[];
  observing?: PDHLObserving;
  last_run?: string | null;
};

export type GoldState = {
  stage: string;
  version?: string;
  strategy: string;
  equity: number;
  starting_balance: number;
  regime?: string;
  circuit_state?: string;
  lever?: number;
  open_position?: OpenPos | null;
  session?: Session;
  active_params?: Record<string, number>;
  backtest_stats?: Partial<{
    oos_sharpe: number;
    oos_dd_pct: number;
    profit_factor: number;
    win_rate: number;
    trades: number;
  }>;
  gates?: Record<string, unknown> & {
    overall_paper?: { skips?: Record<string, number> } & Record<string, unknown>;
  };
  history?: { date: string; equity: number }[];
  recent_trades?: TradeRow[];
  recent_bars?: Bar[];
  observing?: Observing;
  last_run?: string | null;
};
