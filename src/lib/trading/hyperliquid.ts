import "server-only";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { ExchangeError, type ExchangeAdapter, type MarketBuyResult } from "./exchange";

function makeTransport() {
  return new HttpTransport({ isTestnet: process.env.HYPERLIQUID_TESTNET === "1" });
}

function makeInfo() {
  return new InfoClient({ transport: makeTransport() });
}

function makeExchange(privateKey: string) {
  const wallet = privateKeyToAccount(privateKey as `0x${string}`);
  return new ExchangeClient({ transport: makeTransport(), wallet });
}

// HL accepts prices with at most 5 significant figures. Naive toFixed() overshoots
// (e.g. 58.7685 → "58.768500" = 8 sig figs) and the exchange rejects the order.
// Round to 5 sig figs, matching the proven manual-buy path.
function toHlPrice(n: number): string {
  if (!(n > 0)) throw new ExchangeError("hyperliquid", `invalid price: ${n}`);
  const digits = Math.ceil(Math.log10(n));
  const power = 5 - digits;
  const mag = Math.pow(10, power);
  const rounded = Math.round(n * mag) / mag;
  // Trim float noise; HL parses the decimal string.
  return power > 0 ? rounded.toFixed(power) : String(rounded);
}

async function getSpotPairInfo(
  token: string,
): Promise<{ assetId: number; szDecimals: number }> {
  const meta = await makeInfo().spotMeta();
  const upper = token.toUpperCase();

  // Token entry by name. On HL only USDC is isCanonical, so do NOT filter on it —
  // match by unique token name instead.
  const tokenEntry = meta.tokens.find((t) => t.name === upper);
  if (!tokenEntry)
    throw new ExchangeError("hyperliquid", `no spot token: ${token}`);

  // USDC is token index 0. Require the base/USDC pair specifically — a token can
  // have multiple spot pairs against non-USDC quotes.
  const USDC_INDEX = 0;
  const pair = meta.universe.find(
    (u) => u.tokens[0] === tokenEntry.index && u.tokens[1] === USDC_INDEX,
  );
  if (!pair)
    throw new ExchangeError("hyperliquid", `no spot pair for ${token}/USDC`);

  // HL spot asset IDs are offset by 10000
  return { assetId: 10000 + pair.index, szDecimals: tokenEntry.szDecimals };
}

export class HyperliquidAdapter implements ExchangeAdapter {
  readonly venue = "hyperliquid" as const;

  async getUsdBalance(): Promise<number> {
    const addr = process.env.HYPERLIQUID_ACCOUNT_ADDRESS;
    if (!addr) throw new ExchangeError("hyperliquid", "missing HYPERLIQUID_ACCOUNT_ADDRESS");
    const state = await makeInfo().spotClearinghouseState({
      user: addr as `0x${string}`,
    });
    console.log("[hl:balance] coins:", JSON.stringify(state.balances.map((b) => ({ coin: b.coin, total: b.total }))));
    const usdc = state.balances.find((b) => b.coin === "USDC" || b.coin === "@0");
    return usdc ? parseFloat(usdc.total) : 0;
  }

  async getPrice(token: string): Promise<number> {
    // We trade SPOT, so price off the spot mid. HL keys spot pairs as `@{pairIndex}`;
    // the bare token name (e.g. "HYPE") is the PERP mid, which can diverge from spot.
    const [mids, { assetId }] = await Promise.all([
      makeInfo().allMids(),
      getSpotPairInfo(token),
    ]);
    const pairIndex = assetId - 10000;
    const spot = mids[`@${pairIndex}`];
    if (spot) return parseFloat(spot);
    // Fallbacks: explicit USDC pair key, then perp mid as a last resort.
    const upper = token.toUpperCase();
    if (mids[`${upper}/USDC`]) return parseFloat(mids[`${upper}/USDC`]);
    if (mids[upper]) return parseFloat(mids[upper]);
    throw new ExchangeError("hyperliquid", `no mid price for ${token}`);
  }

  async marketBuy(token: string, usdAmount: number): Promise<MarketBuyResult> {
    const pk = process.env.HYPERLIQUID_PRIVATE_KEY;
    if (!pk) throw new ExchangeError("hyperliquid", "missing HYPERLIQUID_PRIVATE_KEY");

    const [price, { assetId, szDecimals }] = await Promise.all([
      this.getPrice(token),
      getSpotPairInfo(token),
    ]);

    // Market buy via limit FrontendMarket (IOC-like) at 5% above mid
    const limitPrice = price * 1.05;
    const rawQty = usdAmount / price;

    // Floor to szDecimals precision
    const factor = Math.pow(10, szDecimals);
    const qty = Math.floor(rawQty * factor) / factor;

    if (qty <= 0) {
      throw new ExchangeError(
        "hyperliquid",
        `order size rounds to zero: $${usdAmount} / ${price} = ${rawQty} ${token}`,
      );
    }

    const exchange = makeExchange(pk);
    const result = await exchange.order({
      orders: [
        {
          a: assetId,
          b: true,
          p: toHlPrice(limitPrice),
          s: qty.toString(),
          r: false,
          t: { limit: { tif: "FrontendMarket" } },
        },
      ],
      grouping: "na",
    });

    const status = result.response.data.statuses[0];
    if (!status) throw new ExchangeError("hyperliquid", "empty statuses array");
    if (typeof status === "string")
      throw new ExchangeError("hyperliquid", `order pending: ${status}`);
    if ("error" in status)
      throw new ExchangeError("hyperliquid", `order rejected: ${status.error}`);

    if ("filled" in status) {
      return {
        orderId: String(status.filled.oid),
        qty: parseFloat(status.filled.totalSz),
        price: parseFloat(status.filled.avgPx),
      };
    }

    // Order rested instead of filling (IOC/FrontendMarket should never rest).
    // Do NOT fabricate a fill — throw so the engine marks it failed, alerts,
    // and retries next period rather than recording a phantom position.
    throw new ExchangeError(
      "hyperliquid",
      `order did not fill (rested oid ${status.resting.oid}) — no fill recorded`,
    );
  }
}
