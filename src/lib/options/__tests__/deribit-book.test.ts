// Deribit serves two books per asset with DIFFERENT price denominations:
//   ETH       (coin-margined) → bid/ask quoted in ETH, must be × underlying_price
//   ETH_USDC  (USDC-margined) → bid/ask already in USD, must NOT be multiplied
// Getting that backwards inflates (or deflates) every premium by ~1,850×, which
// would silently corrupt every entry_premium and P&L number rather than failing
// loudly. These tests pin the denomination handling for both books.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getDeribitChain, buildDeribitInstrument } = await import("../deribit");

const SPOT = 1850;
const EXP = "28AUG26";

// One row per book, same economic option: a 1700-strike put worth $37 .
function bookRows() {
  return [
    // Coin-margined: $37 / $1850 = 0.02 ETH
    { instrument_name: `ETH-${EXP}-1700-P`, bid_price: 0.02, ask_price: 0.021, mark_price: 0.0205, open_interest: 500, volume: 10, mark_iv: 51, underlying_price: SPOT },
    // USDC-margined: quoted directly in USD
    { instrument_name: `ETH_USDC-${EXP}-1700-P`, bid_price: 37, ask_price: 38.5, mark_price: 37.75, open_interest: 840, volume: 12, mark_iv: 51, underlying_price: SPOT },
    // Another asset sharing the USDC book — must be filtered out by prefix.
    { instrument_name: `SOL_USDC-${EXP}-100-P`, bid_price: 5, ask_price: 5.5, mark_price: 5.25, open_interest: 99, volume: 1, mark_iv: 70, underlying_price: 120 },
  ];
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ result: bookRows() }), { status: 200 })
  ));
});
afterEach(() => vi.unstubAllGlobals());

describe("getDeribitChain — book denomination", () => {
  it("converts coin-quoted prices to USD via underlying_price", async () => {
    const ch = await getDeribitChain("ETH");
    expect(ch).not.toBeNull();
    const put = ch!.puts.find((p) => p.strike === 1700)!;
    expect(put.bid).toBeCloseTo(0.02 * SPOT, 6); // 37
  });

  it("leaves USDC-quoted prices alone — no underlying_price multiply", async () => {
    const ch = await getDeribitChain("ETH_USDC");
    expect(ch).not.toBeNull();
    const put = ch!.puts.find((p) => p.strike === 1700)!;
    expect(put.bid).toBe(37);
    // The bug this guards: 37 × 1850 = 68,450, i.e. a premium larger than the
    // notional. Assert it explicitly so the intent survives a refactor.
    expect(put.bid).toBeLessThan(SPOT);
  });

  it("both books agree on USD value for the same economic option", async () => {
    const coin = await getDeribitChain("ETH");
    const usdc = await getDeribitChain("ETH_USDC");
    const a = coin!.puts.find((p) => p.strike === 1700)!.bid;
    const b = usdc!.puts.find((p) => p.strike === 1700)!.bid;
    expect(a).toBeCloseTo(b, 6);
  });

  it("filters the shared USDC book to the requested asset by prefix", async () => {
    const ch = await getDeribitChain("ETH_USDC");
    // SOL_USDC's 100-strike row must not leak into an ETH chain.
    expect(ch!.strikes).toEqual([1700]);
    expect(ch!.puts).toHaveLength(1);
  });

  it("builds USDC instrument names with the full book prefix", () => {
    const unix = Math.floor(Date.UTC(2026, 7, 28, 8) / 1000);
    expect(buildDeribitInstrument("ETH_USDC", unix, 1650, "P")).toBe("ETH_USDC-28AUG26-1650-P");
    expect(buildDeribitInstrument("ETH", unix, 1650, "P")).toBe("ETH-28AUG26-1650-P");
  });
});
