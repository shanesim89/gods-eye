import "server-only";
import type {
  OptionsBroker,
  BrokerAccount,
  BrokerPosition,
  BrokerOptionOrder,
  BrokerOrderResult,
  BrokerOrderSide,
  BrokerActivity,
  BrokerEnvironment,
  BrokerOpenOrder,
} from "./broker";

// Alpaca Trading API adapter. The environment is mandatory so a caller cannot
// describe an action as live while silently using the paper endpoint. Needs
// ALPACA_API_KEY_ID + ALPACA_API_SECRET_KEY. scripts/alpaca-check.mjs verifies
// connectivity standalone.

const PAPER_BASE = "https://paper-api.alpaca.markets";
const LIVE_BASE = "https://api.alpaca.markets";

const SIDE_MAP: Record<BrokerOrderSide, { side: "buy" | "sell"; position_intent: string }> = {
  buy_to_open: { side: "buy", position_intent: "buy_to_open" },
  sell_to_open: { side: "sell", position_intent: "sell_to_open" },
  buy_to_close: { side: "buy", position_intent: "buy_to_close" },
  sell_to_close: { side: "sell", position_intent: "sell_to_close" },
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Alpaca returned invalid ${field}`);
  }
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  if ((typeof value !== "string" && typeof value !== "number") || value === "") {
    throw new Error(`Alpaca returned invalid ${field}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Alpaca returned invalid ${field}`);
  }
  return parsed;
}

function nonNegativeNumber(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (parsed < 0) throw new Error(`Alpaca returned invalid ${field}`);
  return parsed;
}

function contractQuantity(value: unknown, field: string, allowZero = false): number {
  const parsed = finiteNumber(value, field);
  if (!Number.isInteger(parsed) || parsed < 0 || (!allowZero && parsed === 0)) {
    throw new Error(`Alpaca returned invalid ${field}`);
  }
  return parsed;
}

function responseArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) throw new Error(`Alpaca returned invalid ${field}`);
  return value as T[];
}

export class AlpacaBroker implements OptionsBroker {
  readonly name = "alpaca";
  readonly environment: BrokerEnvironment;
  private base: string;
  private headers: Record<string, string>;

  constructor(environment: BrokerEnvironment) {
    const keyId = process.env.ALPACA_API_KEY_ID;
    const secret = process.env.ALPACA_API_SECRET_KEY;
    if (!keyId || !secret) throw new Error("ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY not set");
    this.environment = environment;
    this.base = environment === "live" ? LIVE_BASE : PAPER_BASE;
    this.headers = {
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
    };
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    let r: Response;
    try {
      r = await fetch(`${this.base}${path}`, { ...init, headers: this.headers, cache: "no-store" });
    } catch {
      throw new Error(`Alpaca ${init?.method ?? "GET"} ${path} request failed`);
    }
    if (!r.ok) {
      throw new Error(`Alpaca ${init?.method ?? "GET"} ${path} returned HTTP ${r.status}`);
    }
    if (r.status === 204) return undefined as T; // e.g. DELETE /v2/orders/{id} — no body
    try {
      return await r.json() as T;
    } catch {
      throw new Error(`Alpaca ${init?.method ?? "GET"} ${path} returned invalid JSON`);
    }
  }

  async getAccount(): Promise<BrokerAccount> {
    const a = await this.req<{ id: string; cash: string; buying_power: string; equity: string }>("/v2/account");
    return {
      accountId: requiredString(a.id, "account id"),
      cashUsd: finiteNumber(a.cash, "account cash"),
      buyingPowerUsd: finiteNumber(a.buying_power, "account buying power"),
      equityUsd: finiteNumber(a.equity, "account equity"),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const response = await this.req<unknown>("/v2/positions");
    const rows = responseArray<{ symbol: string; qty: string; avg_entry_price: string; side: string }>(
      response,
      "positions response",
    );
    return rows.map((p) => {
      if (p.side !== "long" && p.side !== "short") {
        throw new Error(`Alpaca returned invalid position side for ${p.symbol}`);
      }
      const contracts = contractQuantity(p.qty, `position quantity for ${p.symbol}`);
      return {
        contractSymbol: requiredString(p.symbol, "position symbol"),
        contracts: p.side === "short" ? -contracts : contracts,
        avgEntryPrice: nonNegativeNumber(p.avg_entry_price, `position average price for ${p.symbol}`),
      };
    });
  }

  async getOpenOrders(): Promise<BrokerOpenOrder[]> {
    const response = await this.req<unknown>(
      "/v2/orders?status=open&nested=false&limit=500&direction=desc",
    );
    const rows = responseArray<{
      id: string;
      symbol: string;
      qty: string;
      filled_qty: string;
      side: "buy" | "sell";
      position_intent: string | null;
    }>(response, "open orders response");

    return rows.map((row) => {
      const brokerOrderId = requiredString(row.id, "order id");
      const contractSymbol = requiredString(row.symbol, `order symbol for ${brokerOrderId}`);
      const side = Object.entries(SIDE_MAP).find(
        ([, mapped]) => mapped.side === row.side && mapped.position_intent === row.position_intent,
      )?.[0] as BrokerOrderSide | undefined;
      if (!side) {
        throw new Error(`Alpaca order ${brokerOrderId} has unsupported option intent ${row.position_intent ?? "unknown"}`);
      }
      const submitted = contractQuantity(row.qty, `submitted quantity for order ${brokerOrderId}`);
      const filled = contractQuantity(row.filled_qty, `filled quantity for order ${brokerOrderId}`, true);
      if (filled > submitted) {
        throw new Error(`Alpaca open order ${brokerOrderId} filled more contracts than submitted`);
      }
      if (filled === submitted) {
        throw new Error(`Alpaca open order ${brokerOrderId} has no positive remaining quantity`);
      }
      return {
        brokerOrderId,
        contractSymbol,
        side,
        contracts: submitted - filled,
      };
    });
  }

  async placeOrder(order: BrokerOptionOrder): Promise<BrokerOrderResult> {
    const contracts = contractQuantity(order.contracts, "submitted order quantity");
    const limitPrice = order.limitPrice == null
      ? undefined
      : finiteNumber(order.limitPrice, "submitted limit price");
    if (limitPrice != null && limitPrice <= 0) {
      throw new Error("Alpaca order limit price must be positive");
    }
    const mapped = SIDE_MAP[order.side];
    if (!mapped) throw new Error("Alpaca order side is invalid");
    const { side, position_intent } = mapped;
    const body = {
      symbol: requiredString(order.contractSymbol, "submitted order symbol"),
      qty: contracts,
      side,
      type: limitPrice != null ? "limit" : "market",
      limit_price: limitPrice,
      time_in_force: "day",
      position_intent,
    };
    const r = await this.req<{ id: string; status: string; filled_avg_price: string | null; filled_qty: string }>(
      "/v2/orders",
      { method: "POST", body: JSON.stringify(body) }
    );
    const filledContracts = contractQuantity(
      r.filled_qty,
      `filled quantity for order ${r.id}`,
      true,
    );
    if (filledContracts > contracts) {
      throw new Error(`Alpaca order ${r.id} filled more contracts than submitted`);
    }
    const filledPrice = r.filled_avg_price == null
      ? undefined
      : nonNegativeNumber(r.filled_avg_price, `filled average price for order ${r.id}`);
    if (filledContracts > 0 && (filledPrice == null || filledPrice === 0)) {
      throw new Error(`Alpaca order ${r.id} has fills without a filled average price`);
    }
    const brokerOrderId = requiredString(r.id, "order id");
    let status: BrokerOrderResult["status"];
    if (r.status === "filled") {
      if (filledContracts !== contracts) {
        throw new Error(`Alpaca filled order ${brokerOrderId} has an inconsistent fill quantity`);
      }
      status = "filled";
    } else if (r.status === "partially_filled") {
      if (filledContracts === 0 || filledContracts >= contracts) {
        throw new Error(`Alpaca partially filled order ${brokerOrderId} has an inconsistent fill quantity`);
      }
      status = "partially_filled";
    } else if (r.status === "rejected") {
      if (filledContracts !== 0) {
        throw new Error(`Alpaca rejected order ${brokerOrderId} unexpectedly reports fills`);
      }
      status = "rejected";
    } else if (["new", "accepted", "pending_new", "accepted_for_bidding", "held", "calculated", "done_for_day", "pending_cancel", "pending_replace", "stopped", "suspended"].includes(r.status)) {
      if (filledContracts !== 0) {
        throw new Error(`Alpaca pending order ${brokerOrderId} unexpectedly reports fills`);
      }
      status = "pending";
    } else {
      throw new Error(`Alpaca order ${brokerOrderId} returned an unsupported status`);
    }
    return {
      brokerOrderId,
      status,
      filledPrice,
      filledContracts: filledContracts > 0 ? filledContracts : undefined,
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    const id = requiredString(brokerOrderId, "cancel order id");
    await this.req<void>(`/v2/orders/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async cancelAllOrders(): Promise<void> {
    await this.req<void>("/v2/orders", { method: "DELETE" });
  }

  async getOptionActivities(sinceDays = 60): Promise<BrokerActivity[]> {
    if (!Number.isInteger(sinceDays) || sinceDays <= 0) {
      throw new Error("Alpaca activity lookback must be a positive integer");
    }
    const after = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
    const response = await this.req<unknown>(
      `/v2/account/activities?activity_types=OPASN,OPEXP,OPCA&after=${after}&direction=desc&page_size=100`,
    );
    const rows = responseArray<{ symbol: string; activity_type: string; date: string; qty: string }>(
      response,
      "option activities response",
    );
    return rows.map((r) => {
      const contractSymbol = requiredString(r.symbol, "activity symbol");
      const activityType = requiredString(r.activity_type, `activity type for ${contractSymbol}`);
      if (!new Set(["OPASN", "OPEXP", "OPCA"]).has(activityType)) {
        throw new Error(`Alpaca returned invalid activity type for ${contractSymbol}`);
      }
      const date = requiredString(r.date, `activity date for ${contractSymbol}`);
      if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(date)) {
        throw new Error(`Alpaca returned invalid activity date for ${contractSymbol}`);
      }
      return {
        contractSymbol,
        activityType,
        date,
        qty: contractQuantity(r.qty, `activity quantity for ${contractSymbol}`),
      };
    });
  }
}
