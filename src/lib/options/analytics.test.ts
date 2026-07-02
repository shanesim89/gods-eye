import { describe, it, expect } from "vitest";
import {
  atmIV,
  expectedMove,
  maxPain,
  putCallRatio,
  contractMetrics,
  payoffCurve,
  ivVsHv,
} from "./analytics";
import type { NormalizedChain, OptRow } from "./symbol";

function row(p: Partial<OptRow> & { strike: number }): OptRow {
  return {
    lastPrice: 0,
    bid: 0,
    ask: 0,
    volume: 0,
    openInterest: 0,
    impliedVolatility: 0,
    inTheMoney: false,
    greeks: null,
    ...p,
  };
}

// Spot 100, IV 20%, simple symmetric chain.
function chain(over: Partial<NormalizedChain> = {}): NormalizedChain {
  return {
    source: "yahoo",
    underlying: "TEST",
    underlyingPrice: 100,
    expiry: 0,
    expirations: [],
    strikes: [90, 100, 110],
    calls: [
      row({ strike: 90, impliedVolatility: 0.22, openInterest: 100 }),
      row({ strike: 100, bid: 4.8, ask: 5.2, impliedVolatility: 0.2, openInterest: 1000, volume: 500 }),
      row({ strike: 110, impliedVolatility: 0.24, openInterest: 100 }),
    ],
    puts: [
      row({ strike: 90, impliedVolatility: 0.26, openInterest: 100 }),
      row({ strike: 100, bid: 4.6, ask: 5.0, impliedVolatility: 0.2, openInterest: 1000, volume: 250 }),
      row({ strike: 110, impliedVolatility: 0.21, openInterest: 100 }),
    ],
    ...over,
  };
}

describe("atmIV", () => {
  it("averages ATM call/put IV", () => {
    expect(atmIV(chain())).toBeCloseTo(0.2, 6);
  });
});

describe("expectedMove", () => {
  it("≈ S·IV·√t for 1σ", () => {
    const em = expectedMove(chain(), 0.25); // √0.25 = 0.5
    expect(em.oneSigma).toBeCloseTo(100 * 0.2 * 0.5, 4); // = 10
    expect(em.oneSigmaHi).toBeCloseTo(110, 4);
    expect(em.oneSigmaLo).toBeCloseTo(90, 4);
  });
  it("computes the ATM straddle expected move", () => {
    // mid call 5.0 + mid put 4.8 = 9.8
    expect(expectedMove(chain(), 0.25).straddle).toBeCloseTo(9.8, 6);
  });
});

describe("maxPain", () => {
  it("finds the strike minimizing total intrinsic owed", () => {
    // OI concentrated at 100 on both sides → pain = 1000·|settle−100|, min at 100
    expect(maxPain(chain())).toBe(100);
  });
  it("shifts toward the side with less open interest", () => {
    const c = chain({
      calls: [row({ strike: 90, openInterest: 5000 }), row({ strike: 110, openInterest: 0 })],
      puts: [row({ strike: 90, openInterest: 0 }), row({ strike: 110, openInterest: 0 })],
      strikes: [90, 110],
    });
    // calls at 90 are ITM whenever settle>90, so pain is minimized at the lowest strike
    expect(maxPain(c)).toBe(90);
  });
});

describe("putCallRatio", () => {
  it("computes OI and volume ratios", () => {
    const pc = putCallRatio(chain());
    expect(pc.oi).toBeCloseTo(1200 / 1200, 6); // equal OI both sides
    expect(pc.volume).toBeCloseTo(250 / 500, 6); // put 250 / call 500
  });
});

describe("contractMetrics — long call", () => {
  const m = contractMetrics(chain(), "C", 100, 0.25, 0.2, 100)!;
  it("breakeven = strike + premium", () => {
    expect(m.premium).toBeCloseTo(5.0, 6); // mid of 4.8/5.2
    expect(m.breakeven).toBeCloseTo(105, 6);
  });
  it("max loss = premium × multiplier, call max gain unlimited", () => {
    expect(m.maxLoss).toBeCloseTo(500, 6);
    expect(m.maxGain).toBeNull();
  });
  it("ATM call POP and probITM are near 50% (slightly below for breakeven)", () => {
    expect(m.probITM).toBeGreaterThan(40);
    expect(m.probITM).toBeLessThan(60);
    expect(m.pop).toBeLessThan(m.probITM); // breakeven is further OTM than the strike
  });
  it("uses BS greeks when the source has none", () => {
    expect(m.greeksSource).toBe("blackscholes");
    expect(m.greeks.delta).toBeGreaterThan(0);
    expect(m.greeks.delta).toBeLessThan(1);
  });
});

describe("payoffCurve — long call", () => {
  const curve = payoffCurve("C", 100, 5, 0.2, 0.25, 100, 100);
  it("loses the full premium at/below the strike at expiry", () => {
    const atStrike = curve.reduce((a, b) =>
      Math.abs(b.price - 100) < Math.abs(a.price - 100) ? b : a
    );
    expect(atStrike.expiry).toBeCloseTo(-500, 0); // −premium × multiplier
  });
  it("is profitable well above breakeven at expiry", () => {
    const high = curve[curve.length - 1]; // ~135
    expect(high.expiry).toBeGreaterThan(0);
    // pnl = (price − 100 − 5) × 100
    expect(high.expiry).toBeCloseTo((high.price - 105) * 100, 0);
  });
});

describe("ivVsHv", () => {
  it("flags rich when IV >> HV", () => {
    expect(ivVsHv(0.6, 0.3).flag).toBe("rich");
  });
  it("flags cheap when IV << HV", () => {
    expect(ivVsHv(0.2, 0.4).flag).toBe("cheap");
  });
});
