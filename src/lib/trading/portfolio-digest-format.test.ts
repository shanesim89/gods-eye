import { describe, expect, it } from "vitest";
import type { BotStatus } from "@/lib/ai-portfolio/overview";
import { formatPortfolioDigest } from "./portfolio-digest-format";

function bot(overrides: Partial<BotStatus> & Pick<BotStatus, "key" | "label">): BotStatus {
  return {
    href: "/ai-portfolio",
    mode: "PAPER",
    asset: "XAUUSD",
    equityOrValue: 10_000,
    valueLabel: "Paper equity",
    pnl: 25,
    pnlPct: 0.25,
    health: "ok",
    lastActivity: null,
    holdings: [],
    recent: [],
    openPositions: 0,
    ...overrides,
  };
}

describe("portfolio Telegram digest", () => {
  it("includes every active trading bot with honest execution modes", () => {
    const text = formatPortfolioDigest([
      bot({ key: "crypto", label: "CRYPTO DCA", mode: "LIVE", valueLabel: "Holdings" }),
      bot({ key: "gold", label: "GOLD SCALPER" }),
      bot({ key: "pdhl", label: "PDH/PDL DAILY" }),
      bot({ key: "quant", label: "QUANT SCALPER" }),
      bot({ key: "options", label: "OPTIONS WHEEL" }),
    ], "Tue, Aug 25, 2026");

    expect(text).toContain("🟢 LIVE: CRYPTO DCA");
    expect(text).toContain("📝 PAPER: GOLD SCALPER");
    expect(text).toContain("📝 PAPER: PDH/PDL DAILY");
    expect(text).toContain("📝 PAPER: QUANT SCALPER");
    expect(text).toContain("📝 PAPER: OPTIONS WHEEL");
    expect(text).not.toContain("LIVE: GOLD SCALPER");
  });

  it("does not append a benched-bot section", () => {
    const text = formatPortfolioDigest([
      bot({ key: "crypto", label: "CRYPTO DCA", mode: "LIVE", valueLabel: "Holdings" }),
      bot({ key: "gold", label: "GOLD SCALPER" }),
      bot({ key: "pdhl", label: "PDH/PDL DAILY" }),
      bot({ key: "quant", label: "QUANT SCALPER" }),
      bot({ key: "options", label: "OPTIONS WHEEL" }),
    ], "Tue, Aug 25, 2026");

    expect(text).not.toContain("OFF / BENCHED");
  });

  it("preserves optional live-bot operational context", () => {
    const text = formatPortfolioDigest([
      bot({ key: "crypto", label: "CRYPTO DCA", mode: "LIVE", valueLabel: "Holdings" }),
    ], "Tue, Aug 25, 2026", {
      liveLines: {
        crypto: ["Monthly cap: $250 / $1,300 used", "Last buys (7d):", "· BTC $50"],
      },
    });

    expect(text).toContain("Monthly cap: $250 / $1,300 used");
    expect(text).toContain("Last buys (7d):");
    expect(text).toContain("· BTC $50");
  });
});
