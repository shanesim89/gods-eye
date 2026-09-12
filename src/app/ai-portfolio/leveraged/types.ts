export type LeveragedStats = {
  trades: number;
  win_rate: number;
  profit_factor: number;
  expectancy_r: number;
  sharpe_ann: number;
  max_dd_pct: number;
  total_return_pct: number;
  avg_hold_min: number;
  clamped_pct: number;
};

export type LeveragedState = {
  version?: string;
  strategy: string;
  equity: number;
  market_open?: boolean;
  cost_stress?: number;
  validated: boolean;
  active_params: {
    ema_fast: number;
    ema_slow: number;
    breakout_lookback_min: number;
    atr_len: number;
    stop_atr_mult: number;
    tp1_atr_mult: number;
    tp1_frac: number;
    max_hold_min: number;
    breakeven_after_tp1: boolean;
    entry_cutoff_min: number;
    eod_flatten_min: number;
  };
  backtest_stats: LeveragedStats;
  permutation?: { p_value?: number; n?: number };
  audit?: Record<string, unknown>;
  session: LeveragedStats;
  open_position: Record<string, Record<string, string>>;
  pending: string[];
  skips: [string, string, string][];
  actions: string[];
  last_run: string | null;
};
