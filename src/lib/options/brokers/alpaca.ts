import "server-only";
import type { OptionsBroker, BrokerAccount, BrokerPosition, BrokerOptionOrder, BrokerOrderResult, BrokerOrderSide, BrokerActivity } from "./broker";

// Alpaca Trading API adapter — paper env by default (paper-api.alpaca.markets).
// Needs ALPACA_API_KEY_ID + ALPACA_API_SECRET_KEY (paper keys from
// https://app.alpaca.markets/paper/dashboard/overview). Wired into engine.ts
// behind `!settings.paper` (live-readiness milestone 1, broker_adapter — see
// scripts/live-readiness-state.json). scripts/alpaca-check.mjs verifies
// connectivity standalone.

const PAPER_BASE = "https://paper-api.alpaca.markets";
const LIVE_BASE = "https://api.alpaca.markets";

const SIDE_MAP: Record<BrokerOrderSide, { side: "buy" | "sell"; position_intent: string }> = {
  buy_to_open: { side: "buy", position_intent: "buy_to_open" },
  sell_to_open: { side: "sell", position_intent: "sell_to_open" },
  buy_to_close: { side: "buy", position_intent: "buy_to_close" },
  sell_to_close: { side: "sell", position_intent: "sell_to_close" },
};

export class AlpacaBroker implements OptionsBroker {
  private base: string;
  private headers: Record<string, string>;

  constructor(opts?: { live?: boolean }) {
    const keyId = process.env.ALPACA_API_KEY_ID;
    const secret = process.env.ALPACA_API_SECRET_KEY;
    if (!keyId || !secret) throw new Error("ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY not set");
    this.base = opts?.live ? LIVE_BASE : PAPER_BASE;
    this.headers = {
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
    };
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(`${this.base}${path}`, { ...init, headers: this.headers, cache: "no-store" });
    if (!r.ok) throw new Error(`Alpaca ${path} → ${r.status} ${await r.text()}`);
    if (r.status === 204) return undefined as T; // e.g. DELETE /v2/orders/{id} — no body
    return r.json() as Promise<T>;
  }

  async getAccount(): Promise<BrokerAccount> {
    const a = await this.req<{ cash: string; buying_power: string; equity: string }>("/v2/account");
    return { cashUsd: Number(a.cash), buyingPowerUsd: Number(a.buying_power), equityUsd: Number(a.equity) };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const rows = await this.req<Array<{ symbol: string; qty: string; avg_entry_price: string; side: string }>>("/v2/positions");
    return rows.map((p) => ({
      contractSymbol: p.symbol,
      contracts: p.side === "short" ? -Math.abs(Number(p.qty)) : Number(p.qty),
      avgEntryPrice: Number(p.avg_entry_price),
    }));
  }

  async placeOrder(order: BrokerOptionOrder): Promise<BrokerOrderResult> {
    const { side, position_intent } = SIDE_MAP[order.side];
    const body = {
      symbol: order.contractSymbol,
      qty: order.contracts,
      side,
      type: order.limitPrice != null ? "limit" : "market",
      limit_price: order.limitPrice,
      time_in_force: "day",
      position_intent,
    };
    const r = await this.req<{ id: string; status: string; filled_avg_price: string | null; filled_qty: string }>(
      "/v2/orders",
      { method: "POST", body: JSON.stringify(body) }
    );
    return {
      brokerOrderId: r.id,
      status: r.status === "filled" ? "filled" : r.status === "partially_filled" ? "partially_filled" : r.status === "rejected" ? "rejected" : "pending",
      filledPrice: r.filled_avg_price ? Number(r.filled_avg_price) : undefined,
      filledContracts: Number(r.filled_qty) || undefined,
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    await this.req<void>(`/v2/orders/${encodeURIComponent(brokerOrderId)}`, { method: "DELETE" });
  }

  async cancelAllOrders(): Promise<void> {
    await this.req<void>("/v2/orders", { method: "DELETE" });
  }

  async getOptionActivities(sinceDays = 60): Promise<BrokerActivity[]> {
    const after = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.req<Array<{ symbol: string; activity_type: string; date: string; qty: string }>>(
      `/v2/account/activities?activity_types=OPASN,OPEXP,OPCA&after=${after}&direction=desc&page_size=100`
    );
    return rows.map((r) => ({
      contractSymbol: r.symbol,
      activityType: r.activity_type,
      date: r.date,
      qty: Number(r.qty),
    }));
  }
}
