import "server-only";
import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_options_positions } from "@/db/schema";
import { AlpacaBroker } from "./alpaca";
import type { BrokerPosition } from "./broker";

// Reconciles our internal ledger (ai_options_positions) against what Alpaca
// actually holds. Only positions with broker_order_id set were opened via a
// real fill (see broker_order_id's comment in schema.ts) — everything else
// is simulated and has no live counterpart to check.
//
// live-readiness milestone "account_sync" — see scripts/live-readiness-state.json.

export type ReconcileMismatch =
  | { kind: "missing_at_broker"; contractSymbol: string; dbPositionId: string }
  | { kind: "unexpected_at_broker"; contractSymbol: string; contracts: number };

export type ReconcileReport = {
  dbLiveOpenCount: number;
  brokerPositionCount: number;
  mismatches: ReconcileMismatch[];
  clean: boolean;
};

export async function reconcileAlpacaPositions(userId: string): Promise<ReconcileReport> {
  const dbRows = await db
    .select({ id: ai_options_positions.id, contract_symbol: ai_options_positions.contract_symbol })
    .from(ai_options_positions)
    .where(
      and(
        eq(ai_options_positions.user_id, userId),
        eq(ai_options_positions.status, "open"),
        isNotNull(ai_options_positions.broker_order_id)
      )
    );

  const broker = new AlpacaBroker();
  const brokerPositions: BrokerPosition[] = await broker.getPositions();

  const dbSymbols = new Set(dbRows.map((r) => r.contract_symbol));
  const brokerSymbols = new Set(brokerPositions.map((p) => p.contractSymbol));

  const mismatches: ReconcileMismatch[] = [];
  for (const row of dbRows) {
    if (!brokerSymbols.has(row.contract_symbol)) {
      mismatches.push({ kind: "missing_at_broker", contractSymbol: row.contract_symbol, dbPositionId: row.id });
    }
  }
  for (const pos of brokerPositions) {
    if (!dbSymbols.has(pos.contractSymbol)) {
      mismatches.push({ kind: "unexpected_at_broker", contractSymbol: pos.contractSymbol, contracts: pos.contracts });
    }
  }

  return {
    dbLiveOpenCount: dbRows.length,
    brokerPositionCount: brokerPositions.length,
    mismatches,
    clean: mismatches.length === 0,
  };
}
