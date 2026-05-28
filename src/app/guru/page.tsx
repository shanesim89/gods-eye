import { Panel } from "@/components/ui/Panel";
import { TickerSearch } from "./_components/TickerSearch";
import { SpxHeatmap } from "./_components/SpxHeatmap";
import { CryptoHeatmap } from "./_components/CryptoHeatmap";
import { FearGreedBar } from "./_components/FearGreedBar";
import { getSpxHeatmap, getCryptoHeatmap, getFearGreed } from "@/lib/market-overview";

export const revalidate = 600; // ISR: refresh data every 10min

const CLASSES = [
  {
    slug: "stocks",
    label: "STOCKS",
    sub: "US equities — NYSE / NASDAQ",
    example: "AAPL",
    color: "text-amber",
  },
  {
    slug: "etf",
    label: "ETF / UNIT TRUST",
    sub: "US-listed ETFs",
    example: "VOO",
    color: "text-cyan",
  },
  {
    slug: "crypto",
    label: "CRYPTO",
    sub: "Top-50 coins via CoinGecko",
    example: "BTC",
    color: "text-green",
  },
  {
    slug: "options",
    label: "OPTIONS",
    sub: "Contract analysis — coming soon",
    example: "SPY-250620C500",
    color: "text-muted",
  },
];

export default async function GuruPage() {
  const [spxRes, cryptoRes, fgRes] = await Promise.allSettled([
    getSpxHeatmap(),
    getCryptoHeatmap(),
    getFearGreed(),
  ]);

  const spx    = spxRes.status    === "fulfilled" ? spxRes.value    : [];
  const crypto = cryptoRes.status === "fulfilled" ? cryptoRes.value : [];
  const fg     = fgRes.status     === "fulfilled" ? fgRes.value     : { crypto: null, stocks: null };

  return (
    <Panel
      title="INVESTMENT GURU"
      meta="MARKET RESEARCH · MULTI-AGENT COUNCIL"
    >
      {/* ── Ticker search ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
        {CLASSES.map((c) => (
          <div
            key={c.slug}
            className="border border-border bg-grid p-4 flex flex-col gap-3"
          >
            <div>
              <div className={`text-[11px] tracking-[1.5px] font-bold ${c.color}`}>
                ▸ {c.label}
              </div>
              <div className="text-dim text-[10px] mt-0.5">{c.sub}</div>
            </div>
            <TickerSearch assetClass={c.slug} />
            <div className="text-dim text-[10px]">
              e.g. <span className="text-muted">{c.example}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Fear & Greed ── */}
      <div className="border border-border bg-grid p-4 mt-3">
        <FearGreedBar crypto={fg.crypto} stocks={fg.stocks} />
      </div>

      {/* ── S&P500 Heatmap ── */}
      <div className="border border-border bg-grid p-3 mt-3">
        <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
          <div>
            <div className="text-muted text-[10px] uppercase tracking-[1px]">
              S&amp;P 500 · TOP 50 BY MKT CAP · DAILY %
            </div>
            <div className="text-dim text-[9px] mt-0.5">
              Sector avg shown · click tile → deep dive · grouped by GICS sector
            </div>
          </div>
          <div className="text-dim text-[9px] leading-relaxed max-w-xs text-right">
            Red sweep = broad sell-off / sector rotation out.{" "}
            Green island in red sea = resilient stock, strong catalyst.{" "}
            Check sector avg % for macro rotation signals.
          </div>
        </div>
        <SpxHeatmap data={spx} />
      </div>

      {/* ── Crypto Heatmap ── */}
      <div className="border border-border bg-grid p-3 mt-3">
        <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
          <div>
            <div className="text-muted text-[10px] uppercase tracking-[1px]">
              CRYPTO · TOP 50 BY MKT CAP · 24H %
            </div>
            <div className="text-dim text-[9px] mt-0.5">
              Tile size = market cap · click tile → deep dive
            </div>
          </div>
          <div className="text-dim text-[9px] leading-relaxed max-w-xs text-right">
            If BTC red + alts green = rotation to alts (alt season signal).{" "}
            All red = deleveraging / liquidation cascade.{" "}
            Stables pumping = capital fleeing to safety.
          </div>
        </div>
        <CryptoHeatmap data={crypto} />
      </div>

      {/* ── Council teaser ── */}
      <div className="border border-border/40 bg-grid p-3 mt-3 text-[10px] text-dim">
        <span className="text-muted">◎ COUNCIL</span> — Phase 3 will add a 4-agent investment
        council (Technical · Fundamental · Sentiment · Macro) that debates each ticker
        and returns a synthesized BUY / HOLD / SELL verdict with confidence score.
        Debate log is collapsible.
      </div>
    </Panel>
  );
}
