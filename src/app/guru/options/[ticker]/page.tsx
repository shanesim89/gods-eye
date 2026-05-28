import { Panel } from "@/components/ui/Panel";
import { CouncilCard } from "@/components/council/CouncilCard";
import { requireUser } from "@/lib/auth";
import { TickerSearch } from "../../_components/TickerSearch";

export const dynamic = "force-dynamic";

export default async function OptionsPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  await requireUser();
  const { ticker } = await params;
  const symbol = decodeURIComponent(ticker).toUpperCase();

  // Parse basic option contract notation: SPY-250620C500
  // Format: UNDERLYING-YYMMDD[C|P]STRIKE
  const match = symbol.match(/^([A-Z]+)-(\d{6})([CP])(\d+(?:\.\d+)?)$/);
  let underlying = symbol;
  let expiry = "";
  let optionType = "";
  let strike = "";

  if (match) {
    underlying = match[1];
    const raw = match[2];
    expiry = `20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
    optionType = match[3] === "C" ? "CALL" : "PUT";
    strike = `$${match[4]}`;
  }

  return (
    <Panel
      title={`${underlying} · OPTIONS`}
      meta={match ? `${optionType} · STRIKE ${strike} · EXP ${expiry}` : "ENTER CONTRACT SYMBOL"}
    >
      <div className="flex items-center justify-between flex-wrap gap-4 mb-5">
        <div className="text-muted text-[11px]">
          {match ? (
            <div className="space-y-1">
              <div className="text-text uppercase text-[13px] font-bold tracking-wider">{symbol}</div>
              <div>{optionType} · Strike {strike} · Expiry {expiry}</div>
              <div className="text-dim text-[10px] mt-2">
                Options chain data requires premium API tier. Coming in future phase.
              </div>
            </div>
          ) : (
            <div>
              <div className="text-dim text-[10px] mt-1">
                Format: UNDERLYING-YYMMDD[C|P]STRIKE · e.g. <span className="text-cyan">SPY-250620C500</span>
              </div>
            </div>
          )}
        </div>
        <TickerSearch assetClass="options" currentTicker={symbol} />
      </div>

      <div className="border border-border bg-grid p-4 text-center">
        <div className="text-amber text-[12px] uppercase tracking-wider mb-2">Options Chain — Coming Soon</div>
        <div className="text-dim text-[10px] leading-relaxed max-w-md mx-auto">
          Full options chain, IV surface, Greeks (delta / gamma / theta / vega), and
          Black-Scholes pricing require a premium market data feed.
          Phase 2C will integrate Polygon.io options data or similar.
        </div>
      </div>

      <div className="mt-3">
        <CouncilCard ticker={symbol} assetClass="options" />
      </div>
    </Panel>
  );
}
