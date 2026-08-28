export type StrategyMode = "LIVE" | "PAPER";

type ActiveStrategy = {
  key: "crypto" | "options" | "quant";
  label: string;
  dashboardLabel: string;
  href: string;
  mode: StrategyMode;
  asset: string;
  description: string;
};

export const ACTIVE_STRATEGIES = [
  {
    key: "crypto",
    label: "CRYPTO DCA",
    dashboardLabel: "CRYPTO",
    href: "/ai-portfolio/crypto",
    mode: "LIVE",
    asset: "BTC·ETH·SOL·HYPE",
    description: "BTC · ETH · SOL · HYPE — live bi-weekly DCA + council buy-zone boost.",
  },
  {
    key: "options",
    label: "OPTIONS WHEEL",
    dashboardLabel: "OPTIONS",
    href: "/ai-portfolio/options",
    mode: "PAPER",
    asset: "—",
    description: "The Wheel + council long plays — paper trading. Defined-risk income.",
  },
  {
    key: "quant",
    label: "QUANT SCALPER",
    dashboardLabel: "QUANT SCALPER",
    href: "/ai-portfolio/quant-scalper",
    mode: "PAPER",
    asset: "BTC·ETH·BNB +",
    description: "Paper-forward research-gated quant bot — TSMOM BTC/ETH/BNB.",
  },
] as const satisfies readonly ActiveStrategy[];

export type BotKey = (typeof ACTIVE_STRATEGIES)[number]["key"];

export const LIVE_STRATEGY_KEYS = ["crypto"] as const satisfies readonly BotKey[];
export const PAPER_STRATEGY_KEYS = ["quant", "options"] as const satisfies readonly BotKey[];
export const CALENDAR_STRATEGY_KEYS = ["quant", "options", "crypto"] as const satisfies readonly BotKey[];

export const ACTIVE_STATE_CACHE_KEYS = [
  "quant:scrap:state",
] as const;

export const RETIRED_CACHE_KEYS = [
  "gold:pdhl:4h:state",
  "gold:pdhl:8h:state",
  "gold:scalper:state",
  "gold:pdhl:state",
] as const;

const RETIRED_INFRA_SERVICES = new Set([
  "goldpdhl4hservice",
  "goldpdhl8hservice",
  "goldvwapservice",
  "goldpdhldailyservice",
]);

export function strategyDefinition(key: BotKey) {
  return ACTIVE_STRATEGIES.find((strategy) => strategy.key === key)!;
}

export function isRetiredInfraService(name: string): boolean {
  return RETIRED_INFRA_SERVICES.has(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
}
