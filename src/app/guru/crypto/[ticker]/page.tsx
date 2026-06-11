import { and, eq } from "drizzle-orm";
import { Panel } from "@/components/ui/Panel";
import { CouncilCard } from "@/components/council/CouncilCard";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { assets } from "@/db/schema";
import { CryptoChart } from "./CryptoChart";
import { TickerSearch } from "../../_components/TickerSearch";

export const dynamic = "force-dynamic";

const COINGECKO = process.env.COINGECKO_API_KEY;
const CG_BASE = "https://api.coingecko.com/api/v3";

// Top-30 ticker→CoinGecko ID map (matches lib/market.ts)
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
  HYPE: "hyperliquid",
  WLD: "worldcoin-wld",
  JUP: "jupiter-ag",
  PENGU: "pudgy-penguins",
  VIRTUAL: "virtual-protocol",
};

function cgHeaders(): Record<string, string> {
  return COINGECKO ? { "x-cg-demo-api-key": COINGECKO } : {};
}

async function cgGet<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${CG_BASE}${path}`, {
      cache: "no-store",
      headers: cgHeaders(),
    });
    if (!r.ok) return null;
    return r.json() as Promise<T>;
  } catch {
    return null;
  }
}

function fmt(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(dec);
}

function fmtBig(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(0)}`;
}

type CoinDetail = {
  id: string;
  symbol: string;
  name: string;
  description: { en: string };
  links: { homepage: string[]; blockchain_site: string[] };
  image: { thumb: string; small: string };
  market_cap_rank: number;
  market_data: {
    current_price: Record<string, number>;
    price_change_percentage_24h: number;
    price_change_percentage_7d: number;
    price_change_percentage_30d: number;
    market_cap: Record<string, number>;
    total_volume: Record<string, number>;
    high_24h: Record<string, number>;
    low_24h: Record<string, number>;
    ath: Record<string, number>;
    ath_change_percentage: Record<string, number>;
    ath_date: Record<string, string>;
    atl: Record<string, number>;
    circulating_supply: number;
    total_supply: number;
    max_supply: number;
  };
};

type MarketChart = {
  prices: [number, number][];
  total_volumes: [number, number][];
};

export default async function CryptoPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const user = await requireUser();
  const { ticker } = await params;
  const symbol = ticker.toUpperCase().replace(/-USDT?$/i, "");

  // Resolve CoinGecko ID. CoinGecko search returns many coins sharing a symbol
  // (e.g. "BTC" matches dozens of forks); pick the one with the LOWEST market_cap_rank,
  // and require an exact symbol match — otherwise refuse rather than silently rendering
  // a wrong coin.
  let cgId: string | null = CRYPTO_IDS[symbol] ?? null;
  let cgAmbiguousNote: string | null = null;
  if (!cgId) {
    const searchRes = await cgGet<{
      coins: { id: string; symbol: string; market_cap_rank: number | null }[];
    }>(`/search?query=${encodeURIComponent(symbol)}`);
    const exact = (searchRes?.coins ?? []).filter(
      (c) => c.symbol?.toUpperCase() === symbol
    );
    if (exact.length === 0) {
      cgId = null;
    } else {
      exact.sort(
        (a, b) =>
          (a.market_cap_rank ?? Number.POSITIVE_INFINITY) -
          (b.market_cap_rank ?? Number.POSITIVE_INFINITY)
      );
      cgId = exact[0]?.id ?? null;
      if (exact.length > 1) {
        cgAmbiguousNote = `${exact.length} coins share symbol ${symbol}; resolved to #${exact[0].market_cap_rank ?? "?"} by mkt cap`;
      }
    }
  }

  const [coinRes, chartRes] = await Promise.allSettled([
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
  ]);

  const coin  = coinRes.status  === "fulfilled" ? coinRes.value  : null;
  const chart = chartRes.status === "fulfilled" ? chartRes.value : null;

  const md = coin?.market_data;
  const price     = md?.current_price?.usd ?? 0;
  const changePct = md?.price_change_percentage_24h ?? 0;

  // Holdings for position-aware council guidance (crypto stored as "crypto").
  const holdingRows = await db
    .select({ qty: assets.qty, costBasis: assets.cost_basis })
    .from(assets)
    .where(and(eq(assets.user_id, user.id), eq(assets.ticker, symbol), eq(assets.asset_class, "crypto")));
  const heldQty = holdingRows.reduce((s, h) => s + (h.qty ? parseFloat(h.qty) : 0), 0);
  const heldCost = holdingRows.reduce((s, h) => s + (h.costBasis ? parseFloat(h.costBasis) : 0), 0);
  const position = heldQty > 0 ? { held: true as const, qty: heldQty, costBasis: heldCost } : { held: false as const };
  const isUp      = changePct >= 0;

  const chartData =
    chart?.prices?.map(([ts, p], i) => ({
      date: new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      price: p,
      volume: chart?.total_volumes?.[i]?.[1] ?? 0,
    })) ?? [];

  const metrics: [string, string][] = [
    ["24H HIGH",     md?.high_24h?.usd != null ? `$${fmt(md.high_24h.usd, md.high_24h.usd >= 1 ? 2 : 6)}` : "—"],
    ["24H LOW",      md?.low_24h?.usd  != null ? `$${fmt(md.low_24h.usd,  md.low_24h.usd  >= 1 ? 2 : 6)}` : "—"],
    ["7D CHANGE",    md?.price_change_percentage_7d != null ? `${fmt(md.price_change_percentage_7d, 2)}%` : "—"],
    ["30D CHANGE",   md?.price_change_percentage_30d != null ? `${fmt(md.price_change_percentage_30d, 2)}%` : "—"],
    ["MARKET CAP",   fmtBig(md?.market_cap?.usd)],
    ["VOLUME 24H",   fmtBig(md?.total_volume?.usd)],
    ["MKT CAP RANK", coin?.market_cap_rank ? `#${coin.market_cap_rank}` : "—"],
    ["ATH",          `$${fmt(md?.ath?.usd)}`],
    ["ATH CHANGE",   md?.ath_change_percentage?.usd != null ? `${fmt(md.ath_change_percentage.usd, 1)}%` : "—"],
    ["CIRCULATING",  md?.circulating_supply != null ? Intl.NumberFormat("en", { notation: "compact" }).format(md.circulating_supply) : "—"],
    ["MAX SUPPLY",   md?.max_supply != null ? Intl.NumberFormat("en", { notation: "compact" }).format(md.max_supply) : "∞"],
  ];

  const valid = price > 0;

  return (
    <Panel
      title={`${symbol} · CRYPTO`}
      meta={coin?.name ?? (valid ? "CRYPTOCURRENCY" : "SYMBOL NOT FOUND")}
    >
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
        <div>
          {valid ? (
            <>
              <div className="text-[36px] font-bold tabular-nums text-amber leading-none">
                ${price >= 1 ? price.toFixed(2) : price.toPrecision(4)}
              </div>
              <div className={`text-[12px] mt-1.5 ${isUp ? "text-green" : "text-red"}`}>
                {isUp ? "+" : ""}{changePct.toFixed(2)}% 24h
              </div>
            </>
          ) : (
            <div className="text-muted text-[12px] italic">
              {cgId ? "no price data" : `unknown ticker — ${symbol} not in top-30 map and search failed`}
            </div>
          )}
          {cgAmbiguousNote && (
            <div className="text-amber text-[10px] mt-1 italic">⚠ {cgAmbiguousNote}</div>
          )}
          {coin?.links?.homepage?.[0] && (
            <a
              href={coin.links.homepage[0]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan hover:text-amber transition-colors text-[10px] mt-2 block"
            >
              {coin.links.homepage[0].replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          )}
        </div>
        <TickerSearch assetClass="crypto" currentTicker={symbol} />
      </div>

      {/* Chart + Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_230px] gap-3 mb-3">
        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[10px] mb-2 uppercase tracking-[1px]">90-DAY PRICE · DAILY (USD)</div>
          <CryptoChart data={chartData} />
        </div>
        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[10px] mb-2 uppercase tracking-[1px]">KEY METRICS</div>
          <table className="w-full text-[11px]">
            <tbody>
              {metrics.map(([k, v]) => (
                <tr key={k} className="dotted-row">
                  <td className="py-0.5 text-muted pr-3 whitespace-nowrap">{k}</td>
                  <td className="py-0.5 text-right text-amber tabular-nums">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Description */}
      {coin?.description?.en && (
        <div className="border border-border bg-grid p-3 mb-3">
          <div className="text-muted text-[10px] mb-2 uppercase tracking-[1px]">ABOUT</div>
          <div
            className="text-dim text-[10px] leading-relaxed line-clamp-4"
            dangerouslySetInnerHTML={{
              __html: coin.description.en.replace(/<[^>]+>/g, "").slice(0, 500) + "…",
            }}
          />
        </div>
      )}

      {/* Investment Council */}
      <CouncilCard ticker={symbol} assetClass="crypto" currentPrice={price > 0 ? price : null} position={position} />
    </Panel>
  );
}
