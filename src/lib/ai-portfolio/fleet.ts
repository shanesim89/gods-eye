export function fleetBookValue(
  bots: { equityOrValue: number }[],
): number {
  return bots.reduce(
    (sum, bot) => sum + (Number.isFinite(bot.equityOrValue) ? bot.equityOrValue : 0),
    0,
  );
}

export function fleetPnl(
  bots: { pnl: number | null }[],
): number {
  return bots.reduce((sum, bot) => sum + (bot.pnl ?? 0), 0);
}
