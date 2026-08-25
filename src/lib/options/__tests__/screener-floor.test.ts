// Covers the floor-adapt behavior in screener.ts's short-leg selection.
//
// Background: a Δ80 LEAPS is deep ITM, so its breakeven (strike + ask) sits well
// ABOVE spot — 9-20% above for real names. A Δ22 short call is only ~7% OTM.
// The screener used to pick the naive Δ22 strike and then REJECT the whole
// candidate when it landed under the breakeven, which is what "floor invariant
// leaves no OTM short room" meant. Measured against the live watchlist that
// rejected the most liquid names outright (SNAP at 5,138 LEAPS OI, SOFI at
// 1,025) while they failed no other filter. The fix constrains the short-strike
// search to strikes ≥ breakeven up front, so those become real (further OTM,
// lower premium) trades instead of no trade at all.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedChain, OptRow } from "../symbol";

vi.mock("server-only", () => ({}));

const getYahooOptions = vi.fn();
vi.mock("@/lib/yahoo", () => ({ getYahooOptions: (...a: unknown[]) => getYahooOptions(...a) }));

const { screenPmccCandidates } = await import("../screener");

const DAY = 86_400_000;
const unix = (d: number) => Math.floor((Date.now() + d * DAY) / 1000);
const LEAPS_EXP = unix(300);
const SHORT_EXP = unix(35);

function row(strike: number, bid: number, ask: number, oi = 500): OptRow {
  return {
    strike,
    lastPrice: (bid + ask) / 2,
    bid,
    ask,
    volume: 100,
    openInterest: oi,
    impliedVolatility: 0.5,
    inTheMoney: false,
    greeks: null,
  };
}

// Spot 10. Δ80 LEAPS lands near strike 7 (spot × 0.70) priced at 4.20 →
// breakeven 11.20, i.e. 12% above spot, while the Δ22 short target is only 10.73.
// That ordering (floor ABOVE target) is the real-world case these tests exist for
// — it's what made the naive nearest-to-target pick land under the floor and get
// the whole candidate thrown away.
function chain(expiry: number, calls: OptRow[]): NormalizedChain {
  return {
    source: "yahoo",
    underlying: "TEST",
    underlyingPrice: 10,
    expiry,
    expirations: [SHORT_EXP, LEAPS_EXP],
    strikes: calls.map((c) => c.strike),
    calls,
    puts: [],
  };
}

const LEAPS_CALLS = [row(7, 4.1, 4.2)]; // breakeven 7 + 4.20 = 11.20
const baseOpts = {
  watchlist: ["TEST"],
  accountSizeUsd: 10_000,
  pmccBudgetPct: 60,
  leapsDelta: 80,
  leapsDteMin: 180,
  leapsDteMax: 365,
  shortDelta: 22,
  shortDteMin: 30,
  shortDteMax: 45,
};

function mockChains(shortCalls: OptRow[]) {
  getYahooOptions.mockImplementation(async (_s: string, exp?: number) => {
    if (exp === LEAPS_EXP) return chain(LEAPS_EXP, LEAPS_CALLS);
    if (exp === SHORT_EXP) return chain(SHORT_EXP, shortCalls);
    // Probe call (no expiry): any chain works, only `expirations` is read.
    return chain(SHORT_EXP, shortCalls);
  });
}

beforeEach(() => getYahooOptions.mockReset());

describe("screener short-leg floor adapt", () => {
  it("picks the nearest strike ABOVE the LEAPS breakeven, not the nearest to Δ-target", async () => {
    // Floor = 11.20, Δ22 target = 10.73. K10.5 is the closest strike to the
    // target (|0.23| vs K11.5's |0.77|), so the OLD nearest-to-target pick chose
    // it — and then rejected the candidate because 10.5 < 11.20. K11.5 is the
    // nearest strike that actually clears the floor and must win now.
    mockChains([row(10.5, 0.85, 0.95), row(11.5, 0.55, 0.65), row(13, 0.1, 0.15)]);
    const r = await screenPmccCandidates(baseOpts);
    expect(r.ranked).toHaveLength(1);
    expect(r.ranked[0].shortStrike).toBe(11.5);
    // The strike the old code would have picked is provably under the floor —
    // this is what makes the assertion above a real discriminator.
    const floor = r.ranked[0].leapsStrike + r.ranked[0].leapsAsk;
    expect(floor).toBeCloseTo(11.2, 6);
    expect(10.5).toBeLessThan(floor);
    expect(r.ranked[0].reasons).toEqual([]);
  });

  it("rejects only when NO listed strike clears the breakeven", async () => {
    // Every short strike is below the 11.20 floor → genuinely unusable.
    mockChains([row(10.5, 0.9, 1.0), row(11, 0.85, 0.95)]);
    const r = await screenPmccCandidates(baseOpts);
    expect(r.ranked).toHaveLength(0);
    expect(r.errors.TEST).toMatch(/above LEAPS breakeven/);
  });

  it("min-yield floor rejects an adapted short whose premium is negligible", async () => {
    // K13 clears the floor but pays ~$0.02 → ~5%/yr on a $420 debit: capital tied
    // up for nothing. Without this guard the floor-adapt would open dead trades.
    mockChains([row(13, 0.01, 0.03)]);
    const r = await screenPmccCandidates(baseOpts);
    expect(r.ranked).toHaveLength(0);
    expect(r.rejected[0].reasons.join(" ")).toMatch(/yield .* < 20%/);
  });

  it("applies the split OI thresholds — a thin LEAPS passes where a thin SHORT does not", async () => {
    // LEAPS OI 30 (held for months, thin is tolerable), short OI 5 (rolled
    // monthly, must be liquid) → rejected on the short leg only. Under the old
    // single OI≥100 gate BOTH legs would have failed.
    getYahooOptions.mockImplementation(async (_s: string, exp?: number) => {
      if (exp === LEAPS_EXP) return chain(LEAPS_EXP, [row(7, 4.1, 4.2, 30)]);
      return chain(SHORT_EXP, [row(11.5, 0.55, 0.65, 5)]);
    });
    const r = await screenPmccCandidates(baseOpts);
    expect(r.ranked).toHaveLength(0);
    const reasons = r.rejected[0].reasons.join(" ");
    expect(reasons).toMatch(/short OI 5 < 25/);
    expect(reasons).not.toMatch(/LEAPS OI/); // 30 ≥ 25, the LEAPS leg is fine
  });
});
