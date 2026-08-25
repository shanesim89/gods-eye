import type { BrokerOpenOrder, BrokerPosition } from "./broker";

export type ApplicationPosition = {
  id: string;
  contractSymbol: string;
  contracts: number;
};

export type ApplicationOpenOrder = {
  id: string;
  contractSymbol: string;
  side: string;
  contracts: number;
};

export type ReconcileMismatch =
  | {
      kind: "position_quantity_mismatch";
      contractSymbol: string;
      applicationContracts: number;
      brokerContracts: number;
      applicationPositionIds: string[];
    }
  | {
      kind: "missing_order_at_broker";
      applicationOrderId: string;
      contractSymbol: string;
      side: string;
      contracts: number;
    }
  | {
      kind: "unexpected_order_at_broker";
      brokerOrderId: string;
      contractSymbol: string;
      side: string;
      contracts: number;
    }
  | {
      kind: "order_mismatch";
      applicationOrderId: string;
      brokerOrderId: string;
      contractSymbol: string;
      applicationSide: string;
      brokerSide: string;
      applicationContracts: number;
      brokerContracts: number;
    };

export type ReconciledPosition = {
  contractSymbol: string;
  applicationContracts: number;
  brokerContracts: number;
  difference: number;
  applicationPositionIds: string[];
};

export type ExactReconciliation = {
  positions: ReconciledPosition[];
  applicationOpenOrders: ApplicationOpenOrder[];
  brokerOpenOrders: BrokerOpenOrder[];
  mismatches: ReconcileMismatch[];
  exactExposureMatch: boolean;
};

function requireContracts(value: number, description: string, allowNegative: boolean): number {
  if (!Number.isInteger(value) || (!allowNegative && value < 0)) {
    throw new Error(`Invalid contract quantity for ${description}`);
  }
  return value;
}

function requireIdentity(value: string, description: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${description}`);
  }
  return value;
}

function aggregateApplicationPositions(rows: ApplicationPosition[]) {
  const aggregate = new Map<string, { contracts: number; ids: string[] }>();
  for (const row of rows) {
    const contractSymbol = requireIdentity(row.contractSymbol, "application position symbol");
    const id = requireIdentity(row.id, `application position id for ${contractSymbol}`);
    const contracts = requireContracts(row.contracts, `application position ${id}`, true);
    if (contracts === 0) throw new Error(`Invalid contract quantity for application position ${id}`);
    const current = aggregate.get(contractSymbol) ?? { contracts: 0, ids: [] };
    current.contracts += contracts;
    current.ids.push(id);
    aggregate.set(contractSymbol, current);
  }
  return aggregate;
}

function aggregateBrokerPositions(rows: BrokerPosition[]) {
  const aggregate = new Map<string, number>();
  for (const row of rows) {
    const contractSymbol = requireIdentity(row.contractSymbol, "broker position symbol");
    const contracts = requireContracts(row.contracts, `broker position ${contractSymbol}`, true);
    if (contracts === 0) throw new Error(`Invalid contract quantity for broker position ${contractSymbol}`);
    aggregate.set(
      contractSymbol,
      (aggregate.get(contractSymbol) ?? 0) + contracts,
    );
  }
  return aggregate;
}

function normalizeSide(side: string): string {
  return requireIdentity(side, "order side").trim().toLowerCase();
}

function validateApplicationOrder(order: ApplicationOpenOrder): void {
  const id = requireIdentity(order.id, "application order id");
  requireIdentity(order.contractSymbol, `application order symbol for ${id}`);
  normalizeSide(order.side);
  requireContracts(order.contracts, `application order ${id}`, false);
  if (order.contracts === 0) throw new Error(`Invalid contract quantity for application order ${id}`);
}

function validateBrokerOrder(order: BrokerOpenOrder): void {
  const id = requireIdentity(order.brokerOrderId, "broker order id");
  requireIdentity(order.contractSymbol, `broker order symbol for ${id}`);
  normalizeSide(order.side);
  requireContracts(order.contracts, `broker order ${id}`, false);
  if (order.contracts === 0) throw new Error(`Invalid contract quantity for broker order ${id}`);
}

function orderMatches(application: ApplicationOpenOrder, broker: BrokerOpenOrder): boolean {
  return application.contractSymbol === broker.contractSymbol
    && normalizeSide(application.side) === normalizeSide(broker.side)
    && application.contracts === broker.contracts;
}

/** Compares exact signed exposure and every pending order, including duplicates. */
export function reconcileExactExposure(
  applicationPositions: ApplicationPosition[],
  brokerPositions: BrokerPosition[],
  applicationOpenOrders: ApplicationOpenOrder[],
  brokerOpenOrders: BrokerOpenOrder[],
): ExactReconciliation {
  applicationOpenOrders.forEach(validateApplicationOrder);
  brokerOpenOrders.forEach(validateBrokerOrder);
  const applicationBySymbol = aggregateApplicationPositions(applicationPositions);
  const brokerBySymbol = aggregateBrokerPositions(brokerPositions);
  const symbols = [...new Set([...applicationBySymbol.keys(), ...brokerBySymbol.keys()])].sort();
  const mismatches: ReconcileMismatch[] = [];
  const positions = symbols.map((contractSymbol) => {
    const application = applicationBySymbol.get(contractSymbol) ?? { contracts: 0, ids: [] };
    const brokerContracts = brokerBySymbol.get(contractSymbol) ?? 0;
    const difference = application.contracts - brokerContracts;
    if (difference !== 0) {
      mismatches.push({
        kind: "position_quantity_mismatch",
        contractSymbol,
        applicationContracts: application.contracts,
        brokerContracts,
        applicationPositionIds: application.ids,
      });
    }
    return {
      contractSymbol,
      applicationContracts: application.contracts,
      brokerContracts,
      difference,
      applicationPositionIds: application.ids,
    };
  });

  const unmatchedBroker = new Set(brokerOpenOrders.map((_, index) => index));
  for (const application of applicationOpenOrders) {
    const exactIndex = brokerOpenOrders.findIndex(
      (broker, index) => unmatchedBroker.has(index) && orderMatches(application, broker),
    );
    if (exactIndex >= 0) {
      unmatchedBroker.delete(exactIndex);
      continue;
    }

    const sameSymbolIndex = brokerOpenOrders.findIndex(
      (broker, index) => unmatchedBroker.has(index) && broker.contractSymbol === application.contractSymbol,
    );
    if (sameSymbolIndex >= 0) {
      const broker = brokerOpenOrders[sameSymbolIndex];
      unmatchedBroker.delete(sameSymbolIndex);
      mismatches.push({
        kind: "order_mismatch",
        applicationOrderId: application.id,
        brokerOrderId: broker.brokerOrderId,
        contractSymbol: application.contractSymbol,
        applicationSide: application.side,
        brokerSide: broker.side,
        applicationContracts: application.contracts,
        brokerContracts: broker.contracts,
      });
      continue;
    }

    mismatches.push({
      kind: "missing_order_at_broker",
      applicationOrderId: application.id,
      contractSymbol: application.contractSymbol,
      side: application.side,
      contracts: application.contracts,
    });
  }

  for (const index of unmatchedBroker) {
    const broker = brokerOpenOrders[index];
    mismatches.push({
      kind: "unexpected_order_at_broker",
      brokerOrderId: broker.brokerOrderId,
      contractSymbol: broker.contractSymbol,
      side: broker.side,
      contracts: broker.contracts,
    });
  }

  return {
    positions,
    applicationOpenOrders,
    brokerOpenOrders,
    mismatches,
    exactExposureMatch: mismatches.length === 0,
  };
}
