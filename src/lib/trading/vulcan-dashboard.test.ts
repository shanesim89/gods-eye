import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  getPrice: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { select: (...args: unknown[]) => mocks.dbSelect(...args) },
}));
vi.mock("@/lib/market", () => ({ getPrice: mocks.getPrice }));

import { getVulcanDashboardData } from "./vulcan-dashboard";

function chain(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  q.from = vi.fn(() => q);
  q.where = vi.fn(() => q);
  q.orderBy = vi.fn(() => Promise.resolve(rows));
  // where() alone resolves for the holdings query (no orderBy chained there).
  q.then = (resolve: (v: unknown[]) => void) => resolve(rows);
  return q;
}

describe("getVulcanDashboardData", () => {
  it("computes holdings P/L, totals, and marks held candidates", async () => {
    const holdingsRows = [
      { symbol: "AAPL", qty: "2", entry_price: "180.00", entry_date: new Date("2026-08-24T13:00:00Z") },
    ];
    const latestDateRows = [{ d: "2026-08-24" }];
    const candidateRows = [
      { symbol: "AAPL", sector: "Information Technology", composite_score: "88.500", composite_rank: 1, stage2_eligible: true },
      { symbol: "MSFT", sector: "Information Technology", composite_score: "70.000", composite_rank: null, stage2_eligible: false },
    ];

    mocks.dbSelect
      .mockImplementationOnce(() => chain(holdingsRows))   // open positions
      .mockImplementationOnce(() => chain(latestDateRows))  // max(run_date)
      .mockImplementationOnce(() => chain(candidateRows));  // this week's scores

    mocks.getPrice.mockResolvedValue({ price: 200, change_pct: 1.2 });

    const data = await getVulcanDashboardData("user-1");

    expect(data.holdings).toEqual([
      {
        symbol: "AAPL",
        qty: 2,
        entryPrice: 180,
        entryDate: "2026-08-24T13:00:00.000Z",
        currentPrice: 200,
        value: 400,
        pnl: 40,
        pnlPct: (40 / 360) * 100,
      },
    ]);
    expect(data.totalValue).toBe(400);
    expect(data.totalPnl).toBe(40);
    expect(data.latestRunDate).toBe("2026-08-24");
    expect(data.candidates).toEqual([
      { symbol: "AAPL", sector: "Information Technology", compositeScore: 88.5, compositeRank: 1, stage2Eligible: true, held: true },
      { symbol: "MSFT", sector: "Information Technology", compositeScore: 70, compositeRank: null, stage2Eligible: false, held: false },
    ]);
  });

  it("returns empty state when there are no positions or scored runs yet", async () => {
    mocks.dbSelect
      .mockImplementationOnce(() => chain([]))
      .mockImplementationOnce(() => chain([{ d: null }]))
      .mockImplementationOnce(() => chain([]));

    const data = await getVulcanDashboardData("user-1");

    expect(data.holdings).toEqual([]);
    expect(data.totalValue).toBe(0);
    expect(data.totalPnl).toBe(0);
    expect(data.latestRunDate).toBeNull();
    expect(data.candidates).toEqual([]);
  });
});
