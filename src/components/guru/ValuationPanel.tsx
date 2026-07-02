import type { EdgarData } from "@/lib/edgar";
import type { YahooSummary } from "@/lib/yahoo";
import { deriveAssumptions } from "@/lib/valuation/assumptions";
import { twoStageDcf, compsTarget, blendTargets, sensitivityGrid } from "@/lib/valuation/model";

function fmt(v: number, dec = 2, prefix = "$"): string {
  return `${prefix}${v.toFixed(dec)}`;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function cellColor(perShare: number, currentPrice: number): string {
  if (currentPrice <= 0) return "text-muted";
  const upside = (perShare - currentPrice) / currentPrice;
  if (upside > 0.3) return "text-green font-bold";
  if (upside > 0.1) return "text-green";
  if (upside > -0.1) return "text-amber";
  if (upside > -0.25) return "text-red";
  return "text-red font-bold";
}

type Props = {
  edgar: EdgarData | null;
  summary: YahooSummary | null;
  price: number;
  currencySymbol: string;
};

export function ValuationPanel({ edgar, summary, price, currencySymbol: cur }: Props) {
  const a = deriveAssumptions(edgar, summary);

  if (!a) {
    return (
      <div className="border border-border bg-grid p-3 mb-3">
        <div className="text-muted text-[10px] mb-1 uppercase tracking-[1px]">VALUATION MODEL</div>
        <div className="text-dim text-[10px] italic">
          Insufficient data — requires FCF &gt; 0 and shares outstanding (US-listed companies with SEC filings).
        </div>
      </div>
    );
  }

  const dcfOut = twoStageDcf(a.dcf);
  const compsOut =
    a.fwdEps != null && a.peFwd != null && a.peFwd > 0
      ? compsTarget(a.fwdEps, a.peFwd)
      : null;

  const blended =
    compsOut != null
      ? blendTargets(dcfOut.perShare, compsOut)
      : null;

  const grid = sensitivityGrid(a.dcf);

  // Interpretation sentence
  const dcfUpside = price > 0 ? (dcfOut.perShare - price) / price : null;
  const compsUpside = compsOut != null && price > 0 ? (compsOut - price) / price : null;
  const blendedUpside = blended != null && price > 0 ? (blended.target - price) / price : dcfUpside;

  function interpretation(): string {
    if (price <= 0 || dcfUpside == null) return "";
    const dcfPart =
      dcfUpside > 0.1
        ? `DCF implies ${Math.round(dcfUpside * 100)}% upside at base assumptions`
        : dcfUpside < -0.1
        ? `DCF implies ${Math.round(Math.abs(dcfUpside) * 100)}% downside at base assumptions`
        : `DCF near fair value at base assumptions`;
    const compsPart =
      compsUpside == null
        ? "no comps data"
        : compsUpside > 0.1
        ? `comps suggest ${Math.round(compsUpside * 100)}% upside`
        : compsUpside < -0.1
        ? `comps suggest ${Math.round(Math.abs(compsUpside) * 100)}% downside`
        : "comps near fair value";
    const blendedPart =
      blendedUpside == null
        ? ""
        : blendedUpside > 0.1
        ? `; blended target implies ${Math.round(blendedUpside * 100)}% upside — stock may be undervalued.`
        : blendedUpside < -0.1
        ? `; blended target implies ${Math.round(Math.abs(blendedUpside) * 100)}% downside — stock trades at a premium to fundamentals.`
        : `; blended target near current price — stock fairly valued on this model.`;
    return `${dcfPart}; ${compsPart}${blendedPart}`;
  }

  const fcfLabel =
    a.fcfSource === "yahoo_fcf" ? "Yahoo free cash flow (OCF − capex)" : "Operating cash flow proxy (no capex)";

  return (
    <div className="border border-border bg-grid p-3 mb-3">
      <div className="text-muted text-[10px] mb-3 uppercase tracking-[1px]">
        VALUATION MODEL · DCF + COMPS
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div className="border border-border/50 p-2">
          <div className="text-dim text-[9px] uppercase tracking-[0.5px] mb-0.5">DCF / SHARE</div>
          <div className="text-amber tabular-nums text-[14px] font-bold">
            {cur}{dcfOut.perShare.toFixed(2)}
          </div>
          <div className="text-dim text-[9px] mt-0.5">
            {price > 0
              ? `${(((dcfOut.perShare - price) / price) * 100).toFixed(0)}% vs price`
              : "no price"}
          </div>
        </div>

        <div className="border border-border/50 p-2">
          <div className="text-dim text-[9px] uppercase tracking-[0.5px] mb-0.5">COMPS / SHARE</div>
          {compsOut != null ? (
            <>
              <div className="text-amber tabular-nums text-[14px] font-bold">
                {cur}{compsOut.toFixed(2)}
              </div>
              <div className="text-dim text-[9px] mt-0.5">
                {price > 0
                  ? `${(((compsOut - price) / price) * 100).toFixed(0)}% vs price`
                  : "no price"}
              </div>
            </>
          ) : (
            <div className="text-dim text-[10px] italic">no fwd P/E</div>
          )}
        </div>

        <div className="border border-border/50 p-2">
          <div className="text-dim text-[9px] uppercase tracking-[0.5px] mb-0.5">BLENDED TARGET</div>
          {blended != null ? (
            <>
              <div className="text-cyan tabular-nums text-[14px] font-bold hud-text-glow">
                {cur}{blended.target.toFixed(2)}
              </div>
              <div className="text-dim text-[9px] mt-0.5">
                {cur}{blended.low.toFixed(0)}–{cur}{blended.high.toFixed(0)} range
              </div>
            </>
          ) : (
            <div className="text-amber tabular-nums text-[14px] font-bold">
              {cur}{dcfOut.perShare.toFixed(2)}
            </div>
          )}
        </div>

        <div className="border border-border/50 p-2">
          <div className="text-dim text-[9px] uppercase tracking-[0.5px] mb-0.5">DCF BREAKDOWN</div>
          <div className="text-[10px] tabular-nums space-y-0.5">
            <div className="flex justify-between gap-2">
              <span className="text-dim">PV flows</span>
              <span className="text-muted">{cur}{(dcfOut.pvCashFlows / 1e9).toFixed(1)}B</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-dim">PV terminal</span>
              <span className="text-muted">{cur}{(dcfOut.pvTerminalValue / 1e9).toFixed(1)}B</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interpretation */}
      {interpretation() && (
        <div className="text-dim text-[10px] italic mb-3 border-l-2 border-cyan/30 pl-2">
          {interpretation()}
        </div>
      )}

      {/* Assumptions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 mb-3 text-[10px]">
        {[
          ["Base FCF", `${cur}${(a.dcf.fcf0 / 1e9).toFixed(2)}B`],
          ["Stage-1 growth", pct(a.dcf.growthStage1)],
          ["Rev CAGR (5yr)", a.revenueCAGR != null ? pct(a.revenueCAGR) : "—"],
          ["Stage-1 years", String(a.dcf.years1)],
          ["Terminal growth", pct(a.dcf.growthTerminal)],
          ["WACC", pct(a.dcf.wacc)],
          ["Shares out", `${(a.dcf.sharesOutstanding / 1e9).toFixed(2)}B`],
          ["FCF source", fcfLabel],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <span className="text-dim shrink-0">{k}:</span>
            <span className="text-muted truncate">{v}</span>
          </div>
        ))}
      </div>

      {/* Sensitivity heatmap */}
      <div className="mb-3">
        <div className="text-dim text-[9px] uppercase tracking-[0.5px] mb-1.5">
          SENSITIVITY · PRICE/SHARE ({cur}) — rows = WACC, cols = terminal growth
        </div>
        <div className="overflow-x-auto">
          <table className="text-[10px] tabular-nums border-collapse">
            <thead>
              <tr>
                <td className="pr-2 pb-1 text-dim text-[9px]">WACC ↓ / g →</td>
                {grid.termAxis.map((g) => (
                  <td key={g} className="px-2 pb-1 text-center text-dim text-[9px]">
                    {pct(g)}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.waccAxis.map((w, wi) => (
                <tr key={w}>
                  <td className="pr-2 py-0.5 text-dim text-[9px]">{pct(w)}</td>
                  {grid.grid[wi].map((ps, gi) => (
                    <td
                      key={gi}
                      className={`px-2 py-0.5 text-center ${cellColor(ps, price)} ${
                        w === a.dcf.wacc && grid.termAxis[gi] === a.dcf.growthTerminal
                          ? "border border-cyan/40"
                          : ""
                      }`}
                    >
                      {ps > 0 ? cur + ps.toFixed(0) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-dim text-[9px] mt-1">
          Base case outlined in cyan ·{" "}
          <span className="text-green">green</span> = &gt;10% upside ·{" "}
          <span className="text-amber">amber</span> = ±10% ·{" "}
          <span className="text-red">red</span> = &gt;10% downside
        </div>
      </div>

      {/* Notes */}
      {a.notes.length > 0 && (
        <div className="text-dim text-[9px] border-t border-border/40 pt-2 space-y-0.5">
          {a.notes.map((n, i) => (
            <div key={i}>⚠ {n}</div>
          ))}
        </div>
      )}

      <div className="text-dim text-[9px] mt-1.5 italic border-t border-border/40 pt-1.5">
        Indicative only — not investment advice. Two-stage DCF + forward P/E comps. WACC fixed at {pct(a.dcf.wacc)}, terminal growth {pct(a.dcf.growthTerminal)}.
        Source: {a.fcfSource === "yahoo_fcf" ? "Yahoo Finance FCF" : "SEC EDGAR OCF"} · SEC EDGAR 10-K revenue history.
      </div>
    </div>
  );
}
