import { Panel } from "@/components/ui/Panel";
import { TickerSearch } from "./_components/TickerSearch";

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
    sub: "Top-30 coins via CoinGecko",
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

export default function GuruPage() {
  return (
    <Panel
      title="INVESTMENT GURU"
      meta="MARKET RESEARCH · MULTI-AGENT COUNCIL"
    >
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
              e.g.{" "}
              <span className="text-muted">{c.example}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border border-border/40 bg-grid p-3 mt-4 text-[10px] text-dim">
        <span className="text-muted">◎ COUNCIL</span> — Phase 3 will add a 4-agent investment
        council (Technical · Fundamental · Sentiment · Macro) that debates each ticker
        and returns a synthesized BUY / HOLD / SELL verdict with confidence score.
        Debate log is collapsible.
      </div>
    </Panel>
  );
}
