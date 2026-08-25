import "server-only";
import { createHash } from "node:crypto";
import type { BrokerEnvironment } from "./broker";

function requiredIdentityPart(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Cannot fingerprint broker account without ${field}`);
  return normalized;
}

/** Stable account identity derived only from non-secret venue metadata. */
export function brokerAccountFingerprint(
  brokerName: string,
  environment: BrokerEnvironment,
  venueAccountId: string,
): string {
  const broker = requiredIdentityPart(brokerName, "broker name").toLowerCase();
  const accountId = requiredIdentityPart(venueAccountId, "venue account id");
  const digest = createHash("sha256")
    .update(`${broker}|${environment}|${accountId}`)
    .digest("hex");
  return `${broker}:${environment}:${digest}`;
}
