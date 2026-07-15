import { describe, it, expect } from "vitest";
import { isTransientScreenerResult } from "./screener-util";
import type { ScreenedCandidate, ScreenerResult } from "./screener";

// Minimal candidate factory — only the fields isTransientScreenerResult reads.
function cand(reasons: string[]): ScreenedCandidate {
  return {
    symbol: "TEST",
    spot: 100,
    leapsStrike: 70,
    leapsExpiry: new Date(),
    leapsDte: 300,
    leapsAsk: 0,
    leapsDebitUsd: 0,
    leapsDelta: 0.8,
    leapsIV: 0.3,
    leapsOI: 0,
    leapsSpreadPct: 0,
    shortStrike: 107,
    shortExpiry: new Date(),
    shortDte: 35,
    shortMid: 0,
    shortOI: 0,
    annualizedYieldPct: 0,
    affordable: false,
    reasons,
  };
}

function result(p: Partial<ScreenerResult>): ScreenerResult {
  return { ranked: [], rejected: [], errors: {}, ...p };
}

describe("isTransientScreenerResult", () => {
  it("is NOT transient when a pick exists", () => {
    expect(isTransientScreenerResult(result({ ranked: [cand([])] }))).toBe(false);
  });

  it("is transient when off-hours zero quotes (no LEAPS ask)", () => {
    // Market closed: ask=0 → debit=0 → 'no LEAPS ask', candidate rejected, ranked empty.
    expect(
      isTransientScreenerResult(result({ rejected: [cand(["no LEAPS ask"]), cand(["no short quote"])] }))
    ).toBe(true);
  });

  it("is transient when every candidate errored on fetch", () => {
    expect(isTransientScreenerResult(result({ errors: { SOFI: "chain fetch failed", F: "no chain" } }))).toBe(true);
  });

  it("is TERMINAL when quotes are live but everything is genuinely unaffordable", () => {
    // Real market-hours quotes, real decision — must NOT roll the claim back.
    expect(
      isTransientScreenerResult(
        result({ rejected: [cand(["debit $12000 > budget $6000"]), cand(["LEAPS OI 40 < 100"])] })
      )
    ).toBe(false);
  });

  it("is TERMINAL when some are unaffordable even if one is quoteless", () => {
    expect(
      isTransientScreenerResult(result({ rejected: [cand(["no LEAPS ask"]), cand(["debit $9000 > budget $6000"])] }))
    ).toBe(false);
  });

  it("is transient (harmless retry) when nothing was screened at all", () => {
    expect(isTransientScreenerResult(result({}))).toBe(true);
  });
});
