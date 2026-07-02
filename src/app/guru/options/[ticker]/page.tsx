import { Panel } from "@/components/ui/Panel";
import { CouncilCard } from "@/components/council/CouncilCard";
import { requireUser } from "@/lib/auth";
import { loadOptionsAnalysis } from "@/lib/options/load";
import { parseContract } from "@/lib/options/symbol";
import { TickerSearch } from "../../_components/TickerSearch";
import { OptionsWorkspace } from "../_components/OptionsWorkspace";

export const dynamic = "force-dynamic";

export default async function OptionsPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  await requireUser();
  const { ticker } = await params;
  const symbol = decodeURIComponent(ticker).toUpperCase();
  const parsed = parseContract(symbol);

  const result = await loadOptionsAnalysis(symbol);
  const a = result.ok ? result.analysis : null;

  const meta = a
    ? `${a.underlying} · ${a.selected ? (a.selected.type === "C" ? "CALL" : "PUT") : ""} ${a.selected ? `$${a.selected.strike}` : ""} · EXP ${a.expiryISO}`
    : "ENTER CONTRACT SYMBOL";

  return (
    <Panel title={`${parsed.underlying} · OPTIONS`} meta={meta}>
      <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
        <div className="text-dim text-[10px]">
          Format: <span className="text-cyan">UNDERLYING-YYMMDD[C|P]STRIKE</span> · e.g.{" "}
          <span className="text-muted">SPY-250620C500</span>, <span className="text-muted">TQQQ-251219P40</span>,{" "}
          <span className="text-muted">BTC-260626C60000</span>
        </div>
        <TickerSearch assetClass="options" currentTicker={symbol} />
      </div>

      {a ? (
        <OptionsWorkspace initial={a} />
      ) : (
        <div className="border border-border bg-grid p-5 text-center">
          <div className="text-amber text-[12px] uppercase tracking-wider mb-2">No Chain Available</div>
          <div className="text-dim text-[10px] leading-relaxed max-w-md mx-auto">
            {result.ok === false ? result.error : "Enter a contract."} Equities/ETFs use the live Yahoo chain; crypto
            (BTC / ETH) uses Deribit. Other coins have no listed options.
          </div>
        </div>
      )}

      <div className="mt-3">
        <CouncilCard ticker={symbol} assetClass="options" />
      </div>
    </Panel>
  );
}
