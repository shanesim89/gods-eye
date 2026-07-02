import type { EdgarData } from "@/lib/edgar";
import type { YahooSummary } from "@/lib/yahoo";
import type { DcfInputs } from "./model";

export type FcfSource = "yahoo_fcf" | "ocf_proxy";

export type ValuationAssumptions = {
  dcf: DcfInputs;
  fwdEps: number | null;
  peFwd: number | null;
  fcfSource: FcfSource;
  revenueCAGR: number | null;
  notes: string[];
};

export function deriveAssumptions(
  edgar: EdgarData | null,
  summary: YahooSummary | null
): ValuationAssumptions | null {
  const shares = summary?.sharesOutstanding ?? null;
  if (!shares || shares <= 0) return null;

  const notes: string[] = [];

  let fcf0: number | null = null;
  let fcfSource: FcfSource = "yahoo_fcf";

  if (summary?.freeCashflow != null && summary.freeCashflow > 0) {
    fcf0 = summary.freeCashflow;
    fcfSource = "yahoo_fcf";
  } else if (edgar?.financials[0]?.operatingCashFlow != null && edgar.financials[0].operatingCashFlow > 0) {
    fcf0 = edgar.financials[0].operatingCashFlow;
    fcfSource = "ocf_proxy";
    notes.push("FCF proxied by OCF — no capex data in EDGAR extract");
  }

  if (!fcf0 || fcf0 <= 0) return null;

  // Revenue CAGR from EDGAR (oldest → newest available year)
  let revenueCAGR: number | null = null;
  if (edgar?.financials && edgar.financials.length >= 2) {
    const sorted = [...edgar.financials]
      .filter((f) => f.revenue != null && f.revenue > 0)
      .sort((a, b) => a.year - b.year);
    if (sorted.length >= 2) {
      const oldest = sorted[0].revenue!;
      const newest = sorted[sorted.length - 1].revenue!;
      const n = sorted[sorted.length - 1].year - sorted[0].year;
      if (n > 0) revenueCAGR = Math.pow(newest / oldest, 1 / n) - 1;
    }
  }

  let growthStage1 = 0.08;
  if (revenueCAGR != null) {
    growthStage1 = Math.min(Math.max(revenueCAGR, -0.05), 0.30);
  } else if (summary?.revenueGrowth != null) {
    growthStage1 = Math.min(Math.max(summary.revenueGrowth / 100, -0.05), 0.30);
    notes.push("Stage-1 growth from Yahoo trailing YoY (no EDGAR CAGR available)");
  } else {
    notes.push("Stage-1 growth defaulted to 8% — no historical data");
  }

  return {
    dcf: {
      fcf0,
      growthStage1,
      years1: 5,
      growthTerminal: 0.025,
      wacc: 0.10,
      sharesOutstanding: shares,
    },
    fwdEps: summary?.epsForward ?? null,
    peFwd: summary?.peForward ?? null,
    fcfSource,
    revenueCAGR,
    notes,
  };
}
