import { describe, it, expect } from "vitest";
import { resolveDirective, type DirectiveInput, type Position, type WheelState } from "./directive";
import type { TradeLevels } from "./types";

// Reference levels: entry 100–110, target 130–150, stop 90, buyTrigger 95, sellTrigger 125.
const L: TradeLevels = {
  entry: { low: 100, high: 110 },
  target: { low: 130, high: 150 },
  stopLoss: 90,
  buyTrigger: 95,
  sellTrigger: 125,
  rationale: "test",
};

const flat: Position = { held: false };
const held = (qty = 10, costBasis: number | null = 1000): Position => ({ held: true, qty, costBasis });

function inp(over: Partial<DirectiveInput>): DirectiveInput {
  return {
    verdict: "HOLD", confidence: 70, tradeLevels: L, currentPrice: 105,
    position: flat, venue: "research", ...over,
  };
}

describe("not holding", () => {
  it("BUY in entry zone → LONG", () => {
    expect(resolveDirective(inp({ verdict: "BUY", currentPrice: 105 })).stance).toBe("LONG");
  });
  it("BUY below entry → LONG", () => {
    expect(resolveDirective(inp({ verdict: "BUY", currentPrice: 96 })).stance).toBe("LONG");
  });
  it("BUY above entry, below target → WAIT", () => {
    expect(resolveDirective(inp({ verdict: "BUY", currentPrice: 120 })).stance).toBe("WAIT");
  });
  it("BUY at target → WAIT (no chase)", () => {
    expect(resolveDirective(inp({ verdict: "BUY", currentPrice: 135 })).stance).toBe("WAIT");
  });
  it("HOLD + price ≤ buyTrigger → LONG", () => {
    expect(resolveDirective(inp({ verdict: "HOLD", currentPrice: 94 })).stance).toBe("LONG");
  });
  it("HOLD otherwise → WAIT", () => {
    expect(resolveDirective(inp({ verdict: "HOLD", currentPrice: 105 })).stance).toBe("WAIT");
  });
  it("SELL research, above entry → SHORT", () => {
    expect(resolveDirective(inp({ verdict: "SELL", currentPrice: 120 })).stance).toBe("SHORT");
  });
  it("SELL research, already low → WAIT", () => {
    expect(resolveDirective(inp({ verdict: "SELL", currentPrice: 95 })).stance).toBe("WAIT");
  });
  it("SELL spot venue → WAIT (no short)", () => {
    expect(resolveDirective(inp({ verdict: "SELL", currentPrice: 120, venue: "spot" })).stance).toBe("WAIT");
  });
  it("low conviction → WAIT", () => {
    expect(resolveDirective(inp({ verdict: "BUY", confidence: 50, currentPrice: 105 })).stance).toBe("WAIT");
  });
});

describe("holding", () => {
  it("below stop → EXIT (override)", () => {
    expect(resolveDirective(inp({ verdict: "BUY", currentPrice: 85, position: held() })).stance).toBe("EXIT");
  });
  it("BUY in zone → ADD", () => {
    expect(resolveDirective(inp({ verdict: "BUY", currentPrice: 105, position: held() })).stance).toBe("ADD");
  });
  it("BUY at target → TRIM", () => {
    expect(resolveDirective(inp({ verdict: "BUY", currentPrice: 135, position: held() })).stance).toBe("TRIM");
  });
  it("BUY above entry, below target → HOLD", () => {
    expect(resolveDirective(inp({ verdict: "BUY", currentPrice: 120, position: held() })).stance).toBe("HOLD");
  });
  it("HOLD + price ≥ sellTrigger → TRIM", () => {
    expect(resolveDirective(inp({ verdict: "HOLD", currentPrice: 128, position: held() })).stance).toBe("TRIM");
  });
  it("HOLD + price ≤ buyTrigger → ADD", () => {
    expect(resolveDirective(inp({ verdict: "HOLD", currentPrice: 94, position: held() })).stance).toBe("ADD");
  });
  it("SELL above entry → TRIM", () => {
    expect(resolveDirective(inp({ verdict: "SELL", currentPrice: 120, position: held() })).stance).toBe("TRIM");
  });
  it("SELL in zone, strong → EXIT", () => {
    expect(resolveDirective(inp({ verdict: "SELL", currentPrice: 105, position: held() })).stance).toBe("EXIT");
  });
  it("SELL low conviction → HOLD (tighten stop)", () => {
    expect(resolveDirective(inp({ verdict: "SELL", confidence: 50, currentPrice: 105, position: held() })).stance).toBe("HOLD");
  });
  it("pnlContext computed", () => {
    const d = resolveDirective(inp({ verdict: "BUY", currentPrice: 105, position: held(10, 1000) }));
    expect(d.pnlContext).toContain("%");
  });
});

describe("wheel (options)", () => {
  const cash: WheelState = { kind: "wheel", state: "cash", shares: 0, costBasisPerShare: null };
  const holding: WheelState = { kind: "wheel", state: "holding_stock", shares: 100, costBasisPerShare: 102 };
  it("cash + BUY(80) → ADD (sell puts)", () => {
    expect(resolveDirective(inp({ verdict: "BUY", confidence: 80, position: cash, venue: "wheel" })).stance).toBe("ADD");
  });
  it("cash + SELL → WAIT", () => {
    expect(resolveDirective(inp({ verdict: "SELL", position: cash, venue: "wheel" })).stance).toBe("WAIT");
  });
  it("holding + SELL → TRIM (sell calls)", () => {
    expect(resolveDirective(inp({ verdict: "SELL", position: holding, venue: "wheel" })).stance).toBe("TRIM");
  });
  it("holding + HOLD → HOLD", () => {
    expect(resolveDirective(inp({ verdict: "HOLD", position: holding, venue: "wheel" })).stance).toBe("HOLD");
  });
});

describe("degrade safely", () => {
  it("tradeLevels null, flat → WAIT no throw", () => {
    expect(resolveDirective(inp({ verdict: "BUY", tradeLevels: null })).stance).toBe("WAIT");
  });
  it("tradeLevels null, holding → HOLD no throw", () => {
    expect(resolveDirective(inp({ verdict: "BUY", tradeLevels: null, position: held() })).stance).toBe("HOLD");
  });
  it("price null, flat → WAIT", () => {
    expect(resolveDirective(inp({ verdict: "BUY", currentPrice: null })).stance).toBe("WAIT");
  });
  it("price null, holding → HOLD", () => {
    expect(resolveDirective(inp({ verdict: "BUY", currentPrice: null, position: held() })).stance).toBe("HOLD");
  });
});
