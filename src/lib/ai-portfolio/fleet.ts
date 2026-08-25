type HealthCarrier = { health: string };

/** Intentionally OFF bots stay visible, but do not represent deployed capital. */
export function isAccountingBot(bot: HealthCarrier): boolean {
  return bot.health !== "off";
}

export function accountingBots<T extends HealthCarrier>(bots: T[]): T[] {
  return bots.filter(isAccountingBot);
}

export function fleetBookValue(
  bots: (HealthCarrier & { equityOrValue: number })[],
): number {
  return accountingBots(bots).reduce(
    (sum, bot) => sum + (Number.isFinite(bot.equityOrValue) ? bot.equityOrValue : 0),
    0,
  );
}

export function fleetPnl(
  bots: (HealthCarrier & { pnl: number | null })[],
): number {
  return accountingBots(bots).reduce((sum, bot) => sum + (bot.pnl ?? 0), 0);
}
