import { Panel } from "@/components/ui/Panel";
import { CouncilCard } from "@/components/council/CouncilCard";
import { requireUser } from "@/lib/auth";
import { currencySymbol } from "@/lib/format";
import {
  getProfile,
  getQuote,
  getBasicFinancials,
  getCompanyNews,
} from "@/lib/finnhub";
import { getYahooData, getYahooSummary } from "@/lib/yahoo";
import { AnalystCard } from "../../_components/AnalystCard";
import { PriceChart } from "./PriceChart";
import { TickerSearch } from "../../_components/TickerSearch";

export const dynamic = "force-dynamic";

function n(v: number | undefined | null, dec = 2, prefix = ""): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  return `${prefix}${v.toFixed(dec)}`;
}

function fmtCap(millions: number | undefined | null, prefix = "$"): string {
  if (millions == null || millions === 0) return "—";
  if (millions >= 1_000_000) return `${prefix}${(millions / 1_000_000).toFixed(2)}T`;
  if (millions >= 1_000) return `${prefix}${(millions / 1_000).toFixed(2)}B`;
  return `${prefix}${millions.toFixed(0)}M`;
}

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  await requireUser();
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  const [profileRes, quoteRes, finRes, yahooRes, summaryRes, newsRes] = await Promise.allSettled([
    getProfile(symbol),
    getQuote(symbol),
    getBasicFinancials(symbol),
    getYahooData(symbol, 90),
    getYahooSummary(symbol),
    getCompanyNews(symbol),
  ]);

  const profile   = profileRes.status  === "fulfilled" ? profileRes.value         : null;
  const quote     = quoteRes.status    === "fulfilled" ? quoteRes.value           : null;
  const fin       = finRes.status      === "fulfilled" ? finRes.value             : null;
  const yahoo     = yahooRes.status    === "fulfilled" ? yahooRes.value           : null;
  const summary   = summaryRes.status  === "fulfilled" ? summaryRes.value         : null;
  const candles   = yahoo?.candles ?? null;
  const newsItems = newsRes.status     === "fulfilled" ? (newsRes.value ?? [])    : [];

  // Diagnose failures so we never silently render price=0.
  const allFetchFailed =
    profileRes.status === "rejected" &&
    quoteRes.status   === "rejected" &&
    yahooRes.status   === "rejected";
  const anyDataPresent = !!(profile || quote?.c || yahoo?.price);

  // Price: Finnhub quote first, Yahoo fallback (Finnhub free tier is rate-limited).
  const price     = quote?.c || yahoo?.price || 0;
  const changePct = quote?.dp ?? yahoo?.changePct ?? 0;
  const changeAbs = quote?.d ?? (yahoo?.prevClose != null ? price - yahoo.prevClose : 0);
  const isUp      = changePct >= 0;
  const ccy       = (profile?.currency || yahoo?.currency || "USD").toUpperCase();
  const cur       = currencySymbol(ccy);

  // Metric sources with Yahoo fallback for fields Finnhub free tier no longer serves.
  const prevClose = quote?.pc || yahoo?.prevClose || undefined;
  const open      = quote?.o  || yahoo?.open      || undefined;
  const dayHigh   = quote?.h  || yahoo?.dayHigh   || undefined;
  const dayLow    = quote?.l  || yahoo?.dayLow    || undefined;
  const wk52High  = fin?.["52WeekHigh"] ?? yahoo?.week52High ?? undefined;
  const wk52Low   = fin?.["52WeekLow"]  ?? yahoo?.week52Low  ?? undefined;

  const chartData =
    candles?.s === "ok" && candles.t?.length
      ? candles.t.map((ts, i) => ({
          date: new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          close: candles.c[i],
          volume: candles.v[i],
        }))
      : [];

  const metrics: [string, string][] = [
    ["PREV CLOSE",   n(prevClose, 2, cur)],
    ["OPEN",         n(open, 2, cur)],
    ["DAY HIGH",     n(dayHigh, 2, cur)],
    ["DAY LOW",      n(dayLow, 2, cur)],
    ["52W HIGH",     n(wk52High, 2, cur)],
    ["52W LOW",      n(wk52Low, 2, cur)],
    ["MKT CAP",      fmtCap(profile?.marketCapitalization, cur)],
    ["P/E",          n(fin?.peNormalizedAnnual, 1)],
    ["EPS (TTM)",    n(fin?.epsTTM, 2, cur)],
    ["BETA",         n(fin?.beta, 2)],
    ["DIV YIELD",    fin?.dividendYieldIndicatedAnnual ? `${n(fin.dividendYieldIndicatedAnnual, 2)}%` : "—"],
    ["ROE (TTM)",    fin?.roeTTM ? `${n(fin.roeTTM, 1)}%` : "—"],
    ["PROFIT MGN",   fin?.netProfitMarginTTM ? `${n(fin.netProfitMarginTTM, 1)}%` : "—"],
    ["DEBT/EQ",      n(fin?.totalDebt_totalEquityQuarterly, 2)],
  ];

  const valid = price > 0;

  return (
    <Panel
      title={`${symbol} · EQUITY`}
      meta={profile?.name ?? yahoo?.name ?? (valid ? "STOCK" : "SYMBOL NOT FOUND")}
    >
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
        <div>
          {valid ? (
            <>
              <div className="text-[36px] font-bold tabular-nums text-amber leading-none">
                {cur}{price.toFixed(2)}
                <span className="text-[12px] text-dim ml-2 font-normal">{ccy}</span>
              </div>
              <div className={`text-[12px] mt-1.5 ${isUp ? "text-green" : "text-red"}`}>
                {isUp ? "+" : ""}{changePct.toFixed(2)}%&nbsp;
                <span className="text-muted">
                  ({isUp ? "+" : ""}{changeAbs.toFixed(2)}) today
                </span>
              </div>
            </>
          ) : (
            <div className="text-muted text-[12px] italic">
              {allFetchFailed
                ? "all data sources unreachable — try again shortly"
                : anyDataPresent
                ? "price feed temporarily unavailable"
                : `no data for ${symbol} — check ticker`}
            </div>
          )}
          {(summary?.sector || summary?.industry) && (
            <div className="text-dim text-[10px] mt-2 uppercase tracking-[0.5px]">
              {[summary.sector, summary.industry].filter(Boolean).join(" · ")}
            </div>
          )}
          {profile?.exchange && (
            <div className="text-dim text-[10px] mt-2 space-y-0.5">
              <div className="uppercase">{profile.exchange} · {profile.finnhubIndustry}</div>
              {profile.ipo && <div>IPO {profile.ipo} · {profile.currency}</div>}
              {profile.weburl && (
                <a
                  href={profile.weburl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan hover:text-amber transition-colors"
                >
                  {profile.weburl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              )}
            </div>
          )}
          {!profile?.exchange && yahoo?.exchange && (
            <div className="text-dim text-[10px] mt-2">
              <div className="uppercase">{yahoo.exchange}</div>
            </div>
          )}
        </div>
        <TickerSearch assetClass="stocks" currentTicker={symbol} />
      </div>

      {/* Chart + Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_230px] gap-3 mb-3">
        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[10px] mb-2 uppercase tracking-[1px]">90-DAY PRICE · DAILY</div>
          <PriceChart data={chartData} currency={cur} />
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

      {/* Analyst consensus */}
      <AnalystCard summary={summary} price={price} currency={ccy} currencySymbol={cur} />

      {/* Investment Council */}
      <div className="mb-3">
        <CouncilCard ticker={symbol} assetClass="stocks" />
      </div>

      {/* News */}
      {newsItems.length > 0 && (
        <div className="border border-border bg-grid p-3">
          <div className="text-muted text-[10px] mb-3 uppercase tracking-[1px]">
            RECENT NEWS · {newsItems.length} ARTICLES
          </div>
          <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
            {newsItems.slice(0, 12).map((item, i) => (
              <div key={i} className="dotted-row pb-2">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-text hover:text-amber transition-colors block leading-tight"
                >
                  {item.headline}
                </a>
                <div className="text-[10px] text-dim mt-0.5">
                  {item.source} ·{" "}
                  {new Date(item.datetime * 1000).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
