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

  it("mentions benched variants neutrally without financial state", () => {
    const text = formatPortfolioDigest([
      bot({ key: "pdhl", label: "PDH/PDL DAILY" }),
      bot({
        key: "pdhl4h",
        label: "PDH/PDL 4H",
        health: "off",
        equityOrValue: 88_888,
        pnl: 8_888,
        healthNote: "benched — disabled on purpose",
      }),
      bot({
        key: "pdhl8h",
        label: "PDH/PDL 8H",
        health: "off",
        equityOrValue: 77_777,
        pnl: 7_777,
      }),
    ], "Tue, Aug 25, 2026");

    expect(text).toContain("⚪ OFF / BENCHED: PDH/PDL 4H · PDH/PDL 8H");
    expect(text).toContain("excluded from fleet accounting and incident alerts");
    expect(text).not.toContain("$88,888");
    expect(text).not.toContain("$77,777");
    expect(text).not.toContain("$8,888");
    expect(text).not.toContain("$7,777");
    expect(text).not.toContain("PAPER: PDH/PDL 4H");
    expect(text).not.toContain("PAPER: PDH/PDL 8H");
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
