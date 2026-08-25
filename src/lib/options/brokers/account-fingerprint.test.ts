import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { brokerAccountFingerprint } = await import("./account-fingerprint");

describe("brokerAccountFingerprint", () => {
  it("is stable and scoped to broker, environment, and non-secret venue account id", () => {
    const first = brokerAccountFingerprint("Alpaca", "paper", "ACCOUNT-123");
    const second = brokerAccountFingerprint(" alpaca ", "paper", " ACCOUNT-123 ");

    expect(first).toBe(second);
    expect(first).toMatch(/^alpaca:paper:[0-9a-f]{64}$/);
    expect(brokerAccountFingerprint("alpaca", "live", "ACCOUNT-123")).not.toBe(first);
    expect(brokerAccountFingerprint("alpaca", "paper", "account-123")).not.toBe(first);
    expect(brokerAccountFingerprint("alpaca", "paper", "ACCOUNT-456")).not.toBe(first);
  });

  it("rejects missing identity facts", () => {
    expect(() => brokerAccountFingerprint("", "paper", "account-123")).toThrow("broker name");
    expect(() => brokerAccountFingerprint("alpaca", "paper", " ")).toThrow("venue account id");
  });
});
