import { describe, expect, it } from "vitest";
import { accountingBots, fleetBookValue, fleetPnl } from "./fleet";

const bots = [
  { key: "crypto", health: "ok", equityOrValue: 12_000, pnl: 500 },
  { key: "gold", health: "stale", equityOrValue: 10_100, pnl: 100 },
  { key: "pdhl4h", health: "off", equityOrValue: 99_999, pnl: 9_999 },
];

describe("AI portfolio fleet accounting", () => {
  it("keeps unhealthy active bots while excluding intentionally off bots", () => {
    expect(accountingBots(bots).map((bot) => bot.key)).toEqual(["crypto", "gold"]);
  });

  it("excludes intentionally off bot equity and P/L", () => {
    expect(fleetBookValue(bots)).toBe(22_100);
    expect(fleetPnl(bots)).toBe(600);
  });

  it("ignores non-finite book values", () => {
    expect(fleetBookValue([
      { health: "ok", equityOrValue: Number.NaN },
      { health: "ok", equityOrValue: 50 },
    ])).toBe(50);
  });
});
