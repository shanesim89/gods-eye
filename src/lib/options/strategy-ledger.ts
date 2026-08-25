import "server-only";
import { createHash } from "node:crypto";
import {
  appendStrategyEvent,
  type AppendStrategyEventInput,
} from "@/lib/trading/ledger";
import type { OptionsStrategyContext } from "./strategy-context";

type EventContext = Pick<OptionsStrategyContext, "identity" | "evidenceClass">;
type EventInput = Omit<
  AppendStrategyEventInput,
  "userId" | "runId" | "strategyKey" | "idempotencyKey" | "source" | "evidenceClass"
>;

export function optionsEventKey(
  context: EventContext,
  ...parts: Array<string | number>
): string {
  return createHash("sha256")
    .update([context.identity.runId, ...parts.map(String)].join("|"))
    .digest("hex");
}

export async function appendOptionsEvent(
  userId: string,
  context: EventContext,
  keyParts: Array<string | number>,
  input: EventInput,
): Promise<boolean> {
  return appendStrategyEvent({
    ...input,
    userId,
    runId: context.identity.runId,
    strategyKey: context.identity.strategyKey,
    idempotencyKey: optionsEventKey(context, ...keyParts),
    source: "options-engine",
    evidenceClass: context.evidenceClass,
  });
}

export type OptionFillEvidence = {
  actionId: string;
  eventAt: Date;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  grossAmount: number;
  fees: number;
  spreadCost?: number;
  slippageCost?: number;
  financingFunding?: number;
  priceProvenance: "executable" | "modeled";
  brokerReference?: string | null;
  detail?: Record<string, unknown>;
};

export async function appendOptionOrderIntent(
  userId: string,
  context: EventContext,
  evidence: {
    actionId: string;
    eventAt: Date;
    symbol: string;
    side: string;
    quantity: number;
    price?: number | null;
    priceProvenance: "executable" | "modeled";
    brokerReference?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<boolean> {
  return appendOptionsEvent(userId, context, [evidence.actionId, "order_intent"], {
    eventType: "order_intent",
    eventAt: evidence.eventAt,
    symbol: evidence.symbol,
    side: evidence.side,
    quantity: evidence.quantity,
    price: evidence.price,
    fees: 0,
    spreadCost: 0,
    slippageCost: 0,
    financingFunding: 0,
    priceProvenance: evidence.priceProvenance,
    brokerReference: evidence.brokerReference,
    detail: evidence.detail,
  });
}

export async function appendOptionExecution(
  userId: string,
  context: EventContext,
  evidence: {
    actionId: string;
    eventAt: Date;
    symbol: string;
    side: string;
    quantity: number;
    price?: number | null;
    priceProvenance: "executable" | "modeled";
    brokerReference?: string | null;
    status: string;
    detail?: Record<string, unknown>;
  },
): Promise<boolean> {
  return appendOptionsEvent(userId, context, [evidence.actionId, "execution"], {
    eventType: "execution",
    eventAt: evidence.eventAt,
    symbol: evidence.symbol,
    side: evidence.side,
    quantity: evidence.quantity,
    price: evidence.price,
    fees: 0,
    spreadCost: 0,
    slippageCost: 0,
    financingFunding: 0,
    priceProvenance: evidence.priceProvenance,
    brokerReference: evidence.brokerReference,
    detail: { ...evidence.detail, status: evidence.status },
  });
}

export async function appendOptionFillTradeCashFlow(
  userId: string,
  context: EventContext,
  evidence: OptionFillEvidence,
): Promise<void> {
  const fact = {
    eventAt: evidence.eventAt,
    symbol: evidence.symbol,
    side: evidence.side,
    quantity: evidence.quantity,
    price: evidence.price,
    priceProvenance: evidence.priceProvenance,
    brokerReference: evidence.brokerReference,
    detail: evidence.detail,
  } as const;

  // A fill and trade describe the same economic action as the cash-flow row.
  // Keep economics only on cash_flow so consumers cannot triple-count gross
  // amount or costs by aggregating all immutable event types.
  await appendOptionsEvent(userId, context, [evidence.actionId, "fill"], {
    ...fact,
    eventType: "fill",
    fees: 0,
    spreadCost: 0,
    slippageCost: 0,
    financingFunding: 0,
  });
  await appendOptionsEvent(userId, context, [evidence.actionId, "trade"], {
    ...fact,
    eventType: "trade",
    fees: 0,
    spreadCost: 0,
    slippageCost: 0,
    financingFunding: 0,
  });
  await appendOptionsEvent(userId, context, [evidence.actionId, "cash_flow"], {
    ...fact,
    eventType: "cash_flow",
    grossAmount: evidence.grossAmount,
    fees: evidence.fees,
    spreadCost: evidence.spreadCost ?? 0,
    slippageCost: evidence.slippageCost ?? 0,
    financingFunding: evidence.financingFunding ?? 0,
  });
}

export async function appendOptionLifecycle(
  userId: string,
  context: EventContext,
  evidence: {
    actionId: string;
    eventAt: Date;
    symbol: string;
    side: string;
    quantity: number;
    price?: number | null;
    grossAmount: number;
    fees: number;
    brokerReference?: string | null;
    detail: Record<string, unknown>;
  },
): Promise<void> {
  const fact = {
    eventAt: evidence.eventAt,
    symbol: evidence.symbol,
    side: evidence.side,
    quantity: evidence.quantity,
    price: evidence.price,
    priceProvenance: "journaled" as const,
    brokerReference: evidence.brokerReference,
    detail: evidence.detail,
  };
  await appendOptionsEvent(userId, context, [evidence.actionId, "trade"], {
    ...fact,
    eventType: "trade",
    fees: 0,
    spreadCost: 0,
    slippageCost: 0,
    financingFunding: 0,
  });
  await appendOptionsEvent(userId, context, [evidence.actionId, "cash_flow"], {
    ...fact,
    eventType: "cash_flow",
    grossAmount: evidence.grossAmount,
    fees: evidence.fees,
    spreadCost: 0,
    slippageCost: 0,
    financingFunding: 0,
  });
}
