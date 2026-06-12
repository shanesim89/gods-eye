// Decision-gate vocabulary + trace builder for the DCA and options engines.
// Pure module — no React, no server-only, no I/O — importable from client
// components (OrderLog renders labels) and from the engines (build traces).
//
// Only { id, outcome, detail } is persisted; labels resolve client-side so
// copy can evolve without backfilling rows. `v` versions the shape.

export const DCA_GATES = [
  "kill_switch",
  "due",
  "price_ceiling",
  "council",
  "sell_skip",
  "buy_zone",
  "monthly_cap",
  "balance",
  "execute",
] as const;
export type DcaGateId = (typeof DCA_GATES)[number];

export const WHEEL_GATES = [
  "kill_switch",
  "due",
  "settle",
  "council",
  "conviction",
  "collateral",
  "select_contract",
  "execute",
] as const;
export type WheelGateId = (typeof WHEEL_GATES)[number];

export type GateId = DcaGateId | WheelGateId;

export type GateOutcome = "pass" | "fail" | "halt" | "skip" | "not_reached";

export type GateEntry = { id: string; outcome: GateOutcome; detail?: string };
export type GateTrace = { v: 1; gates: GateEntry[] };

export const GATE_LABELS: Record<string, string> = {
  kill_switch: "KILL SWITCH",
  due: "CADENCE DUE",
  price_ceiling: "PRICE CEILING",
  council: "COUNCIL VERDICT",
  sell_skip: "SELL-SKIP",
  buy_zone: "BUY-ZONE SIZING",
  monthly_cap: "MONTHLY CAP",
  balance: "BALANCE",
  execute: "EXECUTE",
  settle: "SETTLEMENT",
  conviction: "CONVICTION",
  collateral: "COLLATERAL",
  select_contract: "CONTRACT SELECT",
};

export function gateLabel(id: string): string {
  return GATE_LABELS[id] ?? id.toUpperCase().replace(/_/g, " ");
}

export const GATE_OUTCOME_COLORS: Record<GateOutcome, string> = {
  pass: "#27f59b",
  fail: "#ff5470",
  halt: "#ff5470",
  skip: "#ffcf4a",
  not_reached: "#365360",
};

export class GateTraceBuilder {
  private order: readonly string[];
  private entries = new Map<string, GateEntry>();
  private halted = false;

  constructor(order: readonly string[] = DCA_GATES) {
    this.order = order;
  }

  private record(id: string, outcome: GateOutcome, detail?: string): this {
    if (this.halted) return this; // after a halt nothing else runs
    this.entries.set(id, detail !== undefined ? { id, outcome, detail } : { id, outcome });
    if (outcome === "halt") this.halted = true;
    return this;
  }

  pass(id: string, detail?: string): this {
    return this.record(id, "pass", detail);
  }

  fail(id: string, detail?: string): this {
    return this.record(id, "fail", detail);
  }

  halt(id: string, detail: string): this {
    return this.record(id, "halt", detail);
  }

  skip(id: string, detail?: string): this {
    return this.record(id, "skip", detail);
  }

  done(): GateTrace {
    const gates: GateEntry[] = this.order.map(
      (id) => this.entries.get(id) ?? { id, outcome: "not_reached" }
    );
    return { v: 1, gates };
  }
}

export function newTrace(order: readonly string[] = DCA_GATES): GateTraceBuilder {
  return new GateTraceBuilder(order);
}

// Defensive parse for rows read back from JSONB (old rows are null; future
// versions may differ). Returns null when the shape is unusable.
export function parseGateTrace(raw: unknown): GateTrace | null {
  if (raw == null || typeof raw !== "object") return null;
  const t = raw as { v?: unknown; gates?: unknown };
  if (t.v !== 1 || !Array.isArray(t.gates)) return null;
  return { v: 1, gates: t.gates.filter((g): g is GateEntry => g != null && typeof g === "object" && typeof (g as GateEntry).id === "string") };
}
