import { describe, expect, it } from "vitest";
import {
  ACTIVE_STATE_CACHE_KEYS,
  ACTIVE_STRATEGIES,
  isRetiredInfraService,
  RETIRED_CACHE_KEYS,
} from "./registry";

describe("AI portfolio strategy registry", () => {
  it("contains only the three linked active dashboards", () => {
    expect(ACTIVE_STRATEGIES.map(({ key }) => key)).toEqual([
      "crypto",
      "options",
      "quant",
    ]);
    expect(ACTIVE_STRATEGIES.every(({ href }) => href.startsWith("/ai-portfolio/"))).toBe(true);
  });

  it("keeps retired state keys out of the client polling allowlist", () => {
    for (const key of RETIRED_CACHE_KEYS) {
      expect(ACTIVE_STATE_CACHE_KEYS).not.toContain(key);
    }
  });

  it("excludes all retired gold/PDH-PDL services", () => {
    expect(isRetiredInfraService("gold-pdhl-4h.service")).toBe(true);
    expect(isRetiredInfraService("gold-pdhl-8h.service")).toBe(true);
    expect(isRetiredInfraService("gold-pdhl-daily.service")).toBe(true);
    expect(isRetiredInfraService("gold-vwap.service")).toBe(true);
  });
});
