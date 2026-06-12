import { describe, it, expect } from "vitest";
import { DCA_GATES, WHEEL_GATES, newTrace, parseGateTrace, gateLabel } from "./gates";

describe("GateTraceBuilder", () => {
  it("done() emits gates in canonical order with not_reached fill", () => {
    const t = newTrace().pass("kill_switch").pass("due").done();
    expect(t.v).toBe(1);
    expect(t.gates.map((g) => g.id)).toEqual([...DCA_GATES]);
    expect(t.gates[0].outcome).toBe("pass");
    expect(t.gates[1].outcome).toBe("pass");
    expect(t.gates[2].outcome).toBe("not_reached");
    expect(t.gates[8].outcome).toBe("not_reached");
  });

  it("halt short-circuits later records", () => {
    const t = newTrace()
      .pass("kill_switch")
      .halt("price_ceiling", "price 110 > ceiling 100")
      .pass("council") // must be ignored
      .done();
    const byId = Object.fromEntries(t.gates.map((g) => [g.id, g]));
    expect(byId.price_ceiling.outcome).toBe("halt");
    expect(byId.price_ceiling.detail).toBe("price 110 > ceiling 100");
    expect(byId.council.outcome).toBe("not_reached");
  });

  it("skip and fail record detail", () => {
    const t = newTrace().pass("kill_switch").skip("sell_skip", "SELL 80% — period skipped").done();
    const sellSkip = t.gates.find((g) => g.id === "sell_skip")!;
    expect(sellSkip.outcome).toBe("skip");
    expect(sellSkip.detail).toContain("SELL 80%");
  });

  it("supports wheel gate order", () => {
    const t = newTrace(WHEEL_GATES).pass("kill_switch").done();
    expect(t.gates.map((g) => g.id)).toEqual([...WHEEL_GATES]);
  });
});

describe("parseGateTrace", () => {
  it("null/garbage → null", () => {
    expect(parseGateTrace(null)).toBeNull();
    expect(parseGateTrace("x")).toBeNull();
    expect(parseGateTrace({ v: 2, gates: [] })).toBeNull();
    expect(parseGateTrace({ v: 1 })).toBeNull();
  });
  it("round-trips a built trace", () => {
    const t = newTrace().pass("kill_switch").halt("balance", "insufficient").done();
    const parsed = parseGateTrace(JSON.parse(JSON.stringify(t)));
    expect(parsed).toEqual(t);
  });
});

describe("gateLabel", () => {
  it("known id → label, unknown id → derived", () => {
    expect(gateLabel("kill_switch")).toBe("KILL SWITCH");
    expect(gateLabel("future_gate")).toBe("FUTURE GATE");
  });
});
