// mirrors quant-scrap/mcscalp_eq/live.py's `state = {...}` publish (STATE_KEY = "mcscalp_eq:live:state")
export type AllocatorState = {
  kelly_leverage: number;
  vol_scale: number;
  drawdown_scale: number;
  corr_brake: number;
  leverage_scale: number;
  gross_cap: number;
  port_vol_target: number;
  realized_days: number;
  realized_sharpe_shrunk: number | null;
  realized_vol: number | null;
  realized_base: number | null;
};

export type Trade = {
  symbol: string;
  side: "buy" | "sell";
  usd: number;
  paper: boolean;
  ts: string;
  filled_price?: number;
};

export type MCScalpEqState = {
  bot: string;
  mode: "paper" | "live";
  equity: number;
  weights: Record<string, number>;
  targets_usd: Record<string, number>;
  positions_usd: Record<string, number>;
  allocator: AllocatorState | null;
  trades_today: Trade[];
  universe: string[];
  lookback_days: number;
  target_vol: number;
  cycle_utc: string | null;
  published_at?: string;
};
