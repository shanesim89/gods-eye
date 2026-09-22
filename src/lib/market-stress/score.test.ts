import { describe, it, expect } from "vitest";
import { currentStage, overallScore, hyOasStatus, type StageResult } from "./score";

function stage(id: 1 | 2 | 3 | 4 | 5 | 6, status: StageResult["status"]): StageResult {
  return { id, title: "t", status, quality: "OK", indicators: [] };
}

describe("currentStage", () => {
  it("all green -> stage 1, low score", () => {
    const stages = ([1, 2, 3, 4, 5, 6] as const).map((id) => stage(id, "GREEN"));
    const { stage: s, shockOverride } = currentStage(stages);
    expect(s).toBe(1);
    expect(shockOverride).toBe(false);
    expect(overallScore(stages)).toBeLessThan(20);
  });

  it("HY OAS > 7% (CRITICAL) alone triggers shock override to stage 6", () => {
    expect(hyOasStatus(7.5)).toBe("CRITICAL");
    const stages = ([1, 2, 3, 4, 5, 6] as const).map((id) => stage(id, id === 3 ? "CRITICAL" : "GREEN"));
    const { stage: s, shockOverride } = currentStage(stages);
    expect(s).toBe(6);
    expect(shockOverride).toBe(true);
  });

  it("sequential confirmation stops at first non-confirmed stage", () => {
    const stages = ([1, 2, 3, 4, 5, 6] as const).map((id) => stage(id, id <= 2 ? "YELLOW" : "GREEN"));
    const { stage: s, shockOverride } = currentStage(stages);
    expect(s).toBe(2);
    expect(shockOverride).toBe(false);
  });
});
