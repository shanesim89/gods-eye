import { describe, it, expect } from "vitest";
import { bandExplanation, indexBandExplanation, confidenceBand, type BandMode } from "./display";

const MODES: BandMode[] = ["flat", "holding", "wheel_cash", "wheel_stock"];

describe("confidenceBand boundaries", () => {
  it("49 → AVOID, 50 → LEAN", () => {
    expect(confidenceBand(49)).toBe("AVOID");
    expect(confidenceBand(50)).toBe("LEAN");
  });
  it("64 → LEAN, 65 → MODERATE", () => {
    expect(confidenceBand(64)).toBe("LEAN");
    expect(confidenceBand(65)).toBe("MODERATE");
  });
  it("79 → MODERATE, 80 → STRONG", () => {
    expect(confidenceBand(79)).toBe("MODERATE");
    expect(confidenceBand(80)).toBe("STRONG");
  });
});

describe("bandExplanation", () => {
  it("non-empty for every band x mode", () => {
    for (const c of [30, 52, 60, 70, 90]) {
      for (const m of MODES) {
        expect(bandExplanation(c, m).length).toBeGreaterThan(0);
      }
    }
  });

  it("distinct copy across modes within a band", () => {
    for (const c of [30, 52, 60, 70, 90]) {
      const texts = MODES.map((m) => bandExplanation(c, m));
      expect(new Set(texts).size).toBe(MODES.length);
    }
  });

  it("LEAN branches on the 55 action gate", () => {
    expect(bandExplanation(54, "flat")).not.toBe(bandExplanation(55, "flat"));
    expect(bandExplanation(50, "holding")).toBe(bandExplanation(54, "holding"));
    expect(bandExplanation(55, "holding")).toBe(bandExplanation(64, "holding"));
  });

  it("AVOID copy says do-not-enter when flat, sit-tight when holding", () => {
    expect(bandExplanation(40, "flat").toLowerCase()).toContain("not enter");
    expect(bandExplanation(40, "holding").toLowerCase()).toContain("sit tight");
  });
});

describe("indexBandExplanation", () => {
  it("non-empty for all bands", () => {
    for (const s of [20, 55, 70, 90]) {
      expect(indexBandExplanation(s).length).toBeGreaterThan(0);
    }
  });
  it("distinct per band", () => {
    const texts = [20, 55, 70, 90].map(indexBandExplanation);
    expect(new Set(texts).size).toBe(4);
  });
});
