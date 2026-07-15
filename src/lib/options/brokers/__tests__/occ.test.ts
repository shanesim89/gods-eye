import { describe, expect, it } from "vitest";
import { toOccSymbol, parseOccSymbol } from "../occ";

describe("toOccSymbol", () => {
  it("matches real Alpaca-listed symbols (fetched live 2026-07-15)", () => {
    expect(toOccSymbol("SPY", new Date(Date.UTC(2026, 6, 14)), "C", 500)).toBe("SPY260714C00500000");
    expect(toOccSymbol("SPY", new Date(Date.UTC(2026, 6, 14)), "C", 505)).toBe("SPY260714C00505000");
  });

  it("handles fractional strikes", () => {
    expect(toOccSymbol("AAPL", new Date(Date.UTC(2026, 0, 16)), "P", 150.5)).toBe("AAPL260116P00150500");
  });

  it("uppercases the underlying", () => {
    expect(toOccSymbol("spy", new Date(Date.UTC(2026, 6, 14)), "C", 500)).toBe("SPY260714C00500000");
  });
});

describe("parseOccSymbol", () => {
  it("round-trips a real symbol", () => {
    const parsed = parseOccSymbol("SPY260714C00500000");
    expect(parsed).toEqual({
      underlying: "SPY",
      expiry: new Date(Date.UTC(2026, 6, 14)),
      type: "C",
      strike: 500,
    });
  });

  it("round-trips multi-char underlyings and fractional strikes", () => {
    const symbol = toOccSymbol("AAPL", new Date(Date.UTC(2026, 0, 16)), "P", 150.5);
    expect(parseOccSymbol(symbol)).toEqual({
      underlying: "AAPL",
      expiry: new Date(Date.UTC(2026, 0, 16)),
      type: "P",
      strike: 150.5,
    });
  });

  it("returns null on garbage input", () => {
    expect(parseOccSymbol("not-a-symbol")).toBeNull();
    expect(parseOccSymbol("SPY-260117P00500000")).toBeNull(); // old internal dash format
  });
});
