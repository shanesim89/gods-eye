import { describe, expect, it } from "vitest";
import { reconcileExactExposure } from "./reconcile-core";

describe("reconcileExactExposure", () => {
  it("aggregates duplicate signed positions on both sides", () => {
    const result = reconcileExactExposure(
      [
        { id: "app-1", contractSymbol: "SPY260918P00500000", contracts: -1 },
        { id: "app-2", contractSymbol: "SPY260918P00500000", contracts: -2 },
      ],
      [
        { contractSymbol: "SPY260918P00500000", contracts: -1, avgEntryPrice: 2 },
        { contractSymbol: "SPY260918P00500000", contracts: -2, avgEntryPrice: 2.1 },
      ],
      [],
      [],
    );

    expect(result.exactExposureMatch).toBe(true);
    expect(result.positions).toEqual([{
      contractSymbol: "SPY260918P00500000",
      applicationContracts: -3,
      brokerContracts: -3,
      difference: 0,
      applicationPositionIds: ["app-1", "app-2"],
    }]);
  });

  it("reports exact direction and quantity differences", () => {
    const result = reconcileExactExposure(
      [{ id: "app-1", contractSymbol: "SPY260918P00500000", contracts: -1 }],
      [{ contractSymbol: "SPY260918P00500000", contracts: 1, avgEntryPrice: 2 }],
      [],
      [],
    );

    expect(result.exactExposureMatch).toBe(false);
    expect(result.mismatches).toEqual([{
      kind: "position_quantity_mismatch",
      contractSymbol: "SPY260918P00500000",
      applicationContracts: -1,
      brokerContracts: 1,
      applicationPositionIds: ["app-1"],
    }]);
  });

  it("matches duplicate orders one to one and preserves extras", () => {
    const application = [
      { id: "app-order-1", contractSymbol: "SPY260918P00500000", side: "sell_to_open", contracts: 1 },
      { id: "app-order-2", contractSymbol: "SPY260918P00500000", side: "sell_to_open", contracts: 1 },
    ];
    const broker = [
      { brokerOrderId: "broker-order-1", contractSymbol: "SPY260918P00500000", side: "sell_to_open" as const, contracts: 1 },
      { brokerOrderId: "broker-order-2", contractSymbol: "SPY260918P00500000", side: "sell_to_open" as const, contracts: 1 },
      { brokerOrderId: "broker-order-3", contractSymbol: "SPY260918P00500000", side: "sell_to_open" as const, contracts: 1 },
    ];

    const result = reconcileExactExposure([], [], application, broker);

    expect(result.mismatches).toEqual([{
      kind: "unexpected_order_at_broker",
      brokerOrderId: "broker-order-3",
      contractSymbol: "SPY260918P00500000",
      side: "sell_to_open",
      contracts: 1,
    }]);
  });

  it("distinguishes mismatched, missing, and unexpected orders", () => {
    const result = reconcileExactExposure(
      [],
      [],
      [
        { id: "mismatch", contractSymbol: "SPY260918P00500000", side: "sell_to_open", contracts: 1 },
        { id: "missing", contractSymbol: "QQQ260918C00500000", side: "sell_to_open", contracts: 1 },
      ],
      [
        { brokerOrderId: "wrong", contractSymbol: "SPY260918P00500000", side: "buy_to_close", contracts: 1 },
        { brokerOrderId: "extra", contractSymbol: "IWM260918P00200000", side: "sell_to_open", contracts: 1 },
      ],
    );

    expect(result.mismatches.map((mismatch) => mismatch.kind)).toEqual([
      "order_mismatch",
      "missing_order_at_broker",
      "unexpected_order_at_broker",
    ]);
  });

  it("fails closed on malformed position or order quantities", () => {
    expect(() => reconcileExactExposure(
      [{ id: "bad", contractSymbol: "SPY260918P00500000", contracts: Number.NaN }],
      [],
      [],
      [],
    )).toThrow("Invalid contract quantity");

    expect(() => reconcileExactExposure(
      [],
      [],
      [],
      [{ brokerOrderId: "bad", contractSymbol: "SPY260918P00500000", side: "sell_to_open", contracts: 0 }],
    )).toThrow("Invalid contract quantity");
  });
});
