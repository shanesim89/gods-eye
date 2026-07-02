export type QuantState = {
  stage: string;
  version?: string;
  strategy: string;
  equity: number;
  starting_balance: number;
  daily_ret_pct?: number;
  regime?: string;
  circuit_state?: string;
  lever?: number;
  sleeve_weights?: Record<string, number>;
  allocator?: {
    kelly_leverage: number;
    vol_scale: number;
    drawdown_scale: number;
    corr_brake: number;
    leverage_scale: number;
  };
  top_positions?: { symbol: string; weight: number }[];
  recent_decisions?: {
    ts: string;
    symbol: string;
    action: string;
    prev_w?: number;
    weight: number;
    price?: number;
    regime?: string;
  }[];
  weights?: Record<string, number>;
  prices?: Record<string, number>;
  last_run: string | null;
  history: { date: string; equity: number; regime?: string; circuit?: string; lever?: number }[];
  gates: {
    research: string;
    backtest?: string;
    backtest_v3?: string;
    backtest_v4?: string;
    paper: string;
    live: string;
  };
  backtest_stats: {
    oos_sharpe: number;
    oos_ann_pct: number;
    oos_dd_pct: number;
    full_years: number;
    full_sharpe: number;
    note?: string;
  };
};
