import { describe, expect, it } from "vitest";
import { fleetBookValue, fleetPnl } from "./fleet";

const bots = [
  { key: "crypto", health: "ok", equityOrValue: 12_000, pnl: 500 },
  { key: "gold", health: "stale", equityOrValue: 10_100, pnl: 100 },
  { key: "pdhl", health: "halt", equityOrValue: 9_900, pnl: -50 },
];

describe("AI portfolio fleet accounting", () => {
  it("includes active bots regardless of health state", () => {
    expect(fleetBookValue(bots)).toBe(32_000);
    expect(fleetPnl(bots)).toBe(550);
  });

  it("ignores non-finite book values", () => {
    expect(fleetBookValue([
      { health: "ok", equityOrValue: Number.NaN },
      { health: "ok", equityOrValue: 50 },
    ])).toBe(50);
  });
});
