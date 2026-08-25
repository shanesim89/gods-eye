import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { AlpacaBroker } = await import("./alpaca");

const originalKey = process.env.ALPACA_API_KEY_ID;
const originalSecret = process.env.ALPACA_API_SECRET_KEY;

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.ALPACA_API_KEY_ID = "test-key";
  process.env.ALPACA_API_SECRET_KEY = "test-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey == null) delete process.env.ALPACA_API_KEY_ID;
  else process.env.ALPACA_API_KEY_ID = originalKey;
  if (originalSecret == null) delete process.env.ALPACA_API_SECRET_KEY;
  else process.env.ALPACA_API_SECRET_KEY = originalSecret;
});

describe("AlpacaBroker", () => {
  it.each([
    ["paper", "https://paper-api.alpaca.markets/v2/account"],
    ["live", "https://api.alpaca.markets/v2/account"],
  ] as const)("selects the explicit %s endpoint", async (environment, expectedUrl) => {
    const fetchMock = vi.fn(async () => response({
      id: "venue-account-id",
      cash: "1000",
      buying_power: "2000",
      equity: "1500",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const account = await new AlpacaBroker(environment).getAccount();

    expect(fetchMock).toHaveBeenCalledWith(expectedUrl, expect.any(Object));
    expect(account.accountId).toBe("venue-account-id");
  });

  it("normalizes short positions with signed quantities", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([{
      symbol: "SPY260918P00500000",
      qty: "2",
      avg_entry_price: "1.25",
      side: "short",
    }])));

    await expect(new AlpacaBroker("paper").getPositions()).resolves.toEqual([{
      contractSymbol: "SPY260918P00500000",
      contracts: -2,
      avgEntryPrice: 1.25,
    }]);
  });

  it("normalizes intent and remaining open-order quantity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([{
      id: "order-1",
      symbol: "SPY260918P00500000",
      qty: "3",
      filled_qty: "1",
      side: "sell",
      position_intent: "sell_to_open",
    }])));

    await expect(new AlpacaBroker("paper").getOpenOrders()).resolves.toEqual([{
      brokerOrderId: "order-1",
      contractSymbol: "SPY260918P00500000",
      side: "sell_to_open",
      contracts: 2,
    }]);
  });

  it("rejects unsupported intent and malformed open quantities", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{
        id: "order-1",
        symbol: "SPY260918P00500000",
        qty: "1",
        filled_qty: "0",
        side: "sell",
        position_intent: null,
      }]))
      .mockResolvedValueOnce(response([{
        id: "order-2",
        symbol: "SPY260918P00500000",
        qty: "1",
        filled_qty: "2",
        side: "sell",
        position_intent: "sell_to_open",
      }]))
      .mockResolvedValueOnce(response([{
        id: "order-3",
        symbol: "SPY260918P00500000",
        qty: "not-a-number",
        filled_qty: "0",
        side: "sell",
        position_intent: "sell_to_open",
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const broker = new AlpacaBroker("paper");

    await expect(broker.getOpenOrders()).rejects.toThrow("unsupported option intent");
    await expect(broker.getOpenOrders()).rejects.toThrow("filled more contracts than submitted");
    await expect(broker.getOpenOrders()).rejects.toThrow("invalid submitted quantity");
  });

  it("does not expose broker response bodies or credentials in errors", async () => {
    const sensitiveBody = "broker-debug-body-test-secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sensitiveBody, { status: 500 })));

    const error = await new AlpacaBroker("paper").getAccount().catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected broker account lookup to fail");
    expect(error.message).toBe("Alpaca GET /v2/account returned HTTP 500");
    expect(error.message).not.toContain(sensitiveBody);
    expect(error.message).not.toContain("test-key");
    expect(error.message).not.toContain("test-secret");
  });

  it("sanitizes network failures and rejects invalid JSON", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network detail with test-secret"))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const broker = new AlpacaBroker("paper");

    await expect(broker.getAccount()).rejects.toThrow("GET /v2/account request failed");
    await expect(broker.getAccount()).rejects.toThrow("GET /v2/account returned invalid JSON");
  });

  it("rejects non-array collection responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ positions: [] }))
      .mockResolvedValueOnce(response({ orders: [] }))
      .mockResolvedValueOnce(response({ activities: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const broker = new AlpacaBroker("paper");

    await expect(broker.getPositions()).rejects.toThrow("invalid positions response");
    await expect(broker.getOpenOrders()).rejects.toThrow("invalid open orders response");
    await expect(broker.getOptionActivities()).rejects.toThrow("invalid option activities response");
  });

  it("rejects contradictory order fill states", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        id: "filled-short",
        status: "filled",
        filled_avg_price: "1.25",
        filled_qty: "1",
      }))
      .mockResolvedValueOnce(response({
        id: "pending-with-fill",
        status: "accepted",
        filled_avg_price: "1.25",
        filled_qty: "1",
      }))
      .mockResolvedValueOnce(response({
        id: "unknown-status",
        status: "mystery",
        filled_avg_price: null,
        filled_qty: "0",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const broker = new AlpacaBroker("paper");
    const order = {
      contractSymbol: "SPY260918P00500000",
      side: "sell_to_open" as const,
      contracts: 2,
    };

    await expect(broker.placeOrder(order)).rejects.toThrow("inconsistent fill quantity");
    await expect(broker.placeOrder(order)).rejects.toThrow("unexpectedly reports fills");
    await expect(broker.placeOrder(order)).rejects.toThrow("unsupported status");
  });

  it("rejects invalid open-order and activity terminal values", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{
        id: "order-1",
        symbol: "SPY260918P00500000",
        qty: "1",
        filled_qty: "1",
        side: "sell",
        position_intent: "sell_to_open",
      }]))
      .mockResolvedValueOnce(response([{
        symbol: "SPY260918P00500000",
        activity_type: "UNKNOWN",
        date: "2026-08-24",
        qty: "1",
      }]))
      .mockResolvedValueOnce(response([{
        symbol: "SPY260918P00500000",
        activity_type: "OPEXP",
        date: "not-a-date",
        qty: "1",
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const broker = new AlpacaBroker("paper");

    await expect(broker.getOpenOrders()).rejects.toThrow("no positive remaining quantity");
    await expect(broker.getOptionActivities()).rejects.toThrow("invalid activity type");
    await expect(broker.getOptionActivities()).rejects.toThrow("invalid activity date");
    await expect(broker.getOptionActivities(0)).rejects.toThrow("positive integer");
  });

  it("rejects malformed broker account and position data", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        id: "venue-account-id",
        cash: "NaN",
        buying_power: "2000",
        equity: "1500",
      }))
      .mockResolvedValueOnce(response([{
        symbol: "SPY260918P00500000",
        qty: "0.5",
        avg_entry_price: "1.25",
        side: "short",
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const broker = new AlpacaBroker("paper");

    await expect(broker.getAccount()).rejects.toThrow("invalid account cash");
    await expect(broker.getPositions()).rejects.toThrow("invalid position quantity");
  });
});
