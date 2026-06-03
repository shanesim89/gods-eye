import "server-only";
import {
  getProfile,
  getQuote,
  getBasicFinancials,
  getCompanyNews,
} from "@/lib/finnhub";
import { getYahooData } from "@/lib/yahoo";
import type { AssetClass, CouncilContext } from "./types";

const COINGECKO_KEY = process.env.COINGECKO_API_KEY;
const CG_BASE = "https://api.coingecko.com/api/v3";
const LC_KEY = process.env.LUNARCRUSH_API_KEY;

const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", USDT: "tether",
  BNB: "binancecoin", XRP: "ripple", USDC: "usd-coin", ADA: "cardano",
  DOGE: "dogecoin", AVAX: "avalanche-2", TRX: "tron", LINK: "chainlink",
  MATIC: "polygon", DOT: "polkadot", LTC: "litecoin", NEAR: "near",
  UNI: "uniswap", ICP: "internet-computer", ATOM: "cosmos",
  ETC: "ethereum-classic", BCH: "bitcoin-cash", FIL: "filecoin",
  XLM: "stellar", APT: "aptos", ARB: "arbitrum", OP: "optimism",
  INJ: "injective-protocol", SUI: "sui", TON: "the-open-network",
  RNDR: "render-token",
};

async function cgGet<T>(path: string): Promise<T | null> {
  try {
    const headers: Record<string, string> = COINGECKO_KEY
      ? { "x-cg-demo-api-key": COINGECKO_KEY }
      : {};
    const r = await fetch(`${CG_BASE}${path}`, { cache: "no-store", headers });
    if (!r.ok) return null;
    return r.json() as Promise<T>;
  } catch {
    return null;
  }
}

async function lcGet(endpoint: string): Promise<Record<string, unknown> | null> {
  if (!LC_KEY) return null;
  try {
    const r = await fetch(`https://lunarcrush.com/api4/public${endpoint}`, {
      headers: { Authorization: `Bearer ${LC_KEY}` },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return r.json() as Promise<Record<string, unknown>>;
  } catch {
    return null;
  }
}

async function fetchLunarCrush(
  assetClass: AssetClass,
  ticker: string
): Promise<CouncilContext["lunarcrush"]> {
  try {
    let data: Record<string, unknown> | null = null;
    if (assetClass === "crypto") {
      const cgId = CRYPTO_IDS[ticker.toUpperCase()] ?? ticker.toLowerCase();
      data = await lcGet(`/coins/${cgId}/v1`);
    } else {
      data = await lcGet(`/stocks/${ticker}/v1`);
    }
    if (!data?.data) return null;
    const d = data.data as Record<string, unknown>;
    return {
      galaxyScore: typeof d.galaxy_score === "number" ? d.galaxy_score : null,
      altRank: typeof d.alt_rank === "number" ? d.alt_rank : null,
      socialVolume: typeof d.social_volume === "number" ? d.social_volume : null,
      sentiment: typeof d.sentiment === "number" ? d.sentiment : null,
    };
  } catch {
    return null;
  }
}

export async function buildContext(
  assetClass: AssetClass,
  ticker: string
): Promise<CouncilContext> {
  const symbol = ticker.toUpperCase();

  if (assetClass === "stocks" || assetClass === "etf") {
    const [profileRes, quoteRes, finRes, yahooRes, newsRes, lc] =
      await Promise.allSettled([
        getProfile(symbol),
        getQuote(symbol),
        getBasicFinancials(symbol),
        getYahooData(symbol, 90),
        getCompanyNews(symbol),
        fetchLunarCrush(assetClass, symbol),
      ]);

    const profile = profileRes.status === "fulfilled" ? profileRes.value : null;
    const quote   = quoteRes.status   === "fulfilled" ? quoteRes.value   : null;
    const finRaw  = finRes.status     === "fulfilled" ? finRes.value     : null;
    const yahoo   = yahooRes.status   === "fulfilled" ? yahooRes.value   : null;
    const candles = yahoo?.candles ?? null;
    const news    = newsRes.status    === "fulfilled" ? newsRes.value    : null;
    const lcData  = lc.status         === "fulfilled" ? lc.value         : null;

    // Finnhub free tier no longer serves basic-financials; backfill 52w from Yahoo
    // so the synthesizer's computeRefs has real anchors.
    const fin: Record<string, number | undefined> | null =
      finRaw || yahoo?.week52High != null || yahoo?.week52Low != null
        ? {
            ...(finRaw ?? {}),
            "52WeekHigh": finRaw?.["52WeekHigh"] ?? yahoo?.week52High ?? undefined,
            "52WeekLow":  finRaw?.["52WeekLow"]  ?? yahoo?.week52Low  ?? undefined,
          }
        : null;

    return {
      ticker: symbol,
      assetClass,
      price: quote?.c || yahoo?.price || 0,
      changePct: quote?.dp ?? yahoo?.changePct ?? 0,
      currency: (profile?.currency || yahoo?.currency || "USD").toUpperCase(),
      profile: profile
        ? {
            name: profile.name,
            exchange: profile.exchange,
            industry: profile.finnhubIndustry,
            marketCap: profile.marketCapitalization,
            country: profile.country,
          }
        : null,
      financials: fin,
      candles:
        candles?.s === "ok" && candles.t?.length
          ? {
              dates: candles.t.map((ts) =>
                new Date(ts * 1000).toISOString().slice(0, 10)
              ),
              closes: candles.c,
              volumes: candles.v,
            }
          : null,
      news: news?.slice(0, 10).map((n) => ({
        headline: n.headline,
        source: n.source,
        datetime: n.datetime,
      })) ?? null,
      lunarcrush: lcData,
    };
  }

  if (assetClass === "crypto") {
    const sym = symbol.replace(/-USDT?$/i, "");
    let cgId: string | null = CRYPTO_IDS[sym] ?? null;
    if (!cgId) {
      const sr = await cgGet<{ coins: { id: string; symbol: string }[] }>(
        `/search?query=${encodeURIComponent(sym)}`
      );
      const match =
        sr?.coins?.find((c) => c.symbol?.toUpperCase() === sym) ??
        sr?.coins?.[0];
      cgId = match?.id ?? null;
    }

    type CoinDetail = {
      name: string;
      description: { en: string };
      market_data: {
        current_price: Record<string, number>;
        price_change_percentage_24h: number;
        price_change_percentage_7d: number;
        price_change_percentage_30d: number;
        market_cap: Record<string, number>;
        total_volume: Record<string, number>;
        ath_change_percentage: Record<string, number>;
        circulating_supply: number;
        total_supply: number;
        max_supply: number;
      };
    };
    type MarketChart = {
      prices: [number, number][];
      total_volumes: [number, number][];
    };

    const [coinRes, chartRes, lcRes] = await Promise.allSettled([
      cgId
        ? cgGet<CoinDetail>(
            `/coins/${cgId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
          )
        : Promise.resolve(null),
      cgId
        ? cgGet<MarketChart>(
            `/coins/${cgId}/market_chart?vs_currency=usd&days=90&interval=daily`
          )
        : Promise.resolve(null),
      fetchLunarCrush("crypto", sym),
    ]);

    const coin  = coinRes.status === "fulfilled" ? coinRes.value : null;
    const chart = chartRes.status === "fulfilled" ? chartRes.value : null;
    const lcData = lcRes.status  === "fulfilled" ? lcRes.value  : null;
    const md = coin?.market_data;

    const cryptoCandles =
      chart?.prices?.length
        ? {
            dates: chart.prices.map(([ts]) =>
              new Date(ts).toISOString().slice(0, 10)
            ),
            closes: chart.prices.map(([, p]) => p),
            volumes: chart.total_volumes?.map(([, v]) => v) ?? [],
          }
        : null;

    return {
      ticker: sym,
      assetClass,
      price: md?.current_price?.usd ?? 0,
      changePct: md?.price_change_percentage_24h ?? 0,
      currency: "USD",
      candles: cryptoCandles,
      cryptoMeta: coin
        ? {
            name: coin.name,
            marketCap: md?.market_cap?.usd ?? 0,
            volume24h: md?.total_volume?.usd ?? 0,
            change7d: md?.price_change_percentage_7d ?? 0,
            change30d: md?.price_change_percentage_30d ?? 0,
            circulatingSupply: md?.circulating_supply ?? 0,
            maxSupply: md?.max_supply ?? null,
            athChangePct: md?.ath_change_percentage?.usd ?? 0,
            description: coin.description?.en?.replace(/<[^>]+>/g, "").slice(0, 600) ?? "",
          }
        : null,
      lunarcrush: lcData,
    };
  }

  // options
  const match = symbol.match(/^([A-Z]+)-(\d{6})([CP])(\d+(?:\.\d+)?)$/);
  let underlying = symbol;
  let optionsMeta: CouncilContext["optionsMeta"] = null;

  if (match) {
    underlying = match[1];
    const raw = match[2];
    const expiry = `20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
    const optionType = match[3] === "C" ? "CALL" : "PUT";
    const strike = `$${match[4]}`;
    const [quoteRes, finRes, yahooRes, lcRes] = await Promise.allSettled([
      getQuote(underlying),
      getBasicFinancials(underlying),
      getYahooData(underlying, 90),
      fetchLunarCrush("stocks", underlying),
    ]);
    const quote   = quoteRes.status   === "fulfilled" ? quoteRes.value   : null;
    const finRaw  = finRes.status     === "fulfilled" ? finRes.value     : null;
    const yahoo   = yahooRes.status   === "fulfilled" ? yahooRes.value   : null;
    const candles = yahoo?.candles ?? null;
    const lcData  = lcRes.status      === "fulfilled" ? lcRes.value      : null;
    const underlyingPrice = quote?.c || yahoo?.price || 0;
    const fin: Record<string, number | undefined> | null =
      finRaw || yahoo?.week52High != null || yahoo?.week52Low != null
        ? {
            ...(finRaw ?? {}),
            "52WeekHigh": finRaw?.["52WeekHigh"] ?? yahoo?.week52High ?? undefined,
            "52WeekLow":  finRaw?.["52WeekLow"]  ?? yahoo?.week52Low  ?? undefined,
          }
        : null;
    optionsMeta = { underlying, optionType, strike, expiry, underlyingPrice };
    return {
      ticker: symbol,
      assetClass,
      price: underlyingPrice,
      changePct: quote?.dp ?? yahoo?.changePct ?? 0,
      currency: (yahoo?.currency || "USD").toUpperCase(),
      financials: fin,
      candles:
        candles?.s === "ok" && candles.t?.length
          ? {
              dates: candles.t.map((ts) =>
                new Date(ts * 1000).toISOString().slice(0, 10)
              ),
              closes: candles.c,
              volumes: candles.v,
            }
          : null,
      optionsMeta,
      lunarcrush: lcData,
    };
  }

  return { ticker: symbol, assetClass, price: 0, changePct: 0, currency: "USD" };
}
