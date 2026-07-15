// Maps ReportDataV2 (the AI/schema shape, snake_case, mirrors record_report_v2)
// into the camelCase props each report page component expects. Kept as a pure
// function so both the real generated report and any static preview data can
// flow through the same page components.
import type { Page2Data } from "@/components/market-outlook/report/Page2Quarter";
import type { Page3Data } from "@/components/market-outlook/report/Page3Value";
import type { Page4Data, FundCard } from "@/components/market-outlook/report/Page4Income";
import type { MacroBackdrop, Page5Data } from "@/components/market-outlook/report/Page5Opportunities";
import type { Page6Data } from "@/components/market-outlook/report/Page6Ahead";
import { FUND_SCRAPES } from "./sources";
import { CENTRAL_BANKS, CYCLE_REGIONS, QUADRANT_ASSETS, type FundDistributionV2, type FundKey, type FundNarrativeV2, type ReportDataV2 } from "./types";

function clamp(min: number, max: number, n: number | null | undefined, fallback: number): number {
  if (n == null || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Hard word-count truncation — the real overflow guarantee for the PDF export.
// html2canvas 1.4.1 (DownloadPdfButtonV2) does NOT implement `-webkit-line-clamp`,
// so a CSS line-clamp visually truncates the on-screen preview but the exported
// PDF paints the full string and overflows/overlaps neighbouring blocks. The
// prompt (generate-v2.ts) asks the model to stay under each field's word budget,
// but that isn't enforceable — this clamps deterministically so the layout can
// never break regardless of what the model returns. Limits sit slightly above
// the prompt caps so normal, compliant output is never cut; only genuine
// overruns get trimmed at a word boundary with an ellipsis.
function truncateWords(s: string | null | undefined, maxWords: number): string {
  if (!s) return "";
  const words = s.trim().split(/\s+/);
  if (words.length <= maxWords) return s.trim();
  return words.slice(0, maxWords).join(" ").replace(/[,;:.—-]+$/, "") + "…";
}

const FUND_SCRAPE_BY_KEY = Object.fromEntries(FUND_SCRAPES.map((s) => [s.key, s])) as Record<FundKey, (typeof FUND_SCRAPES)[number]>;
const FUND_SOURCE_NAMES = new Set(FUND_SCRAPES.map((s) => s.name));

// The single Claude call drafts page2/3/5 narrative together from one shared
// source pool (see stream/route.ts) — there's no real per-page isolation to
// report, so every narrative page honestly cites the same full list of what
// actually scraped ok this run, resolved to real URLs where one exists
// (search-result "sources" only ever get a pseudo `search:...` url and render
// as plain, non-clickable text). Fund-factsheet scrapes are excluded here —
// they're figures-only inputs (page4 cites them directly per-fund instead),
// not narrative sources, even though they technically shared the same prompt.
function resolveSources(names: string[] | undefined, urlMap: Record<string, string> | undefined): { name: string; url: string | null }[] {
  return (names ?? []).filter((name) => !FUND_SOURCE_NAMES.has(name)).map((name) => ({ name, url: urlMap?.[name] ?? null }));
}

// Iterates the fixed roster (not the model's returned array) so shape/order/
// count is guaranteed regardless of model compliance — same defensive
// pattern as parseFundDistributions for page4.
export function mapMacroBackdrop(report: ReportDataV2): MacroBackdrop {
  const p5 = report.page5;
  switch (p5.macro_type) {
    case "cycle":
      return {
        type: "cycle",
        positions: CYCLE_REGIONS.map((r) => {
          const found = p5.cycle_positions?.find((x) => x.region === r.key);
          return { region: r.label, code: r.code, phasePct: clamp(0, 100, found?.phase_pct, 50) };
        }),
      };
    case "growth_inflation":
      return {
        type: "growth_inflation",
        positions: QUADRANT_ASSETS.map((asset) => {
          const found = p5.quadrant_positions?.find((x) => x.asset === asset);
          return { asset, growth: clamp(-100, 100, found?.growth, 0), inflation: clamp(-100, 100, found?.inflation, 0) };
        }),
      };
    case "central_bank":
      return {
        type: "central_bank",
        stances: CENTRAL_BANKS.map((b) => {
          const found = p5.central_bank_stances?.find((x) => x.bank === b.key);
          return { bank: b.key, label: b.label, stance: found?.stance ?? "holding", note: found?.note ?? "" };
        }),
      };
    case "index_heatmap":
      return { type: "index_heatmap", entries: p5.index_heatmap ?? [] };
    case "yield_curve":
      return { type: "yield_curve", points: (p5.yield_curve ?? []).map((pt) => ({ tenor: pt.tenor, yieldPct: pt.yieldPct })) };
    case "vix_gauge":
      return { type: "vix_gauge", gauge: p5.vix_gauge ?? { value: 18, level: "neutral" } };
  }
}

function toFundCard(name: string, ticker: string, narrative: FundNarrativeV2, dist: FundDistributionV2, fundKey: FundKey): FundCard {
  return {
    name,
    ticker,
    purpose: truncateWords(narrative.purpose, 26),
    incomeSources: narrative.income_sources.slice(0, 3),
    whatChanged: truncateWords(narrative.what_changed, 30),
    yieldPct: dist.yieldPct,
    frequency: dist.frequency,
    verified: dist.verified,
    quarterChangePct: dist.quarterChangePct,
    sourceUrl: FUND_SCRAPE_BY_KEY[fundKey].url,
  };
}

export function mapPage2(report: ReportDataV2): Page2Data {
  return {
    overview: truncateWords(report.page2.overview, 85),
    events: report.page2.events.slice(0, 3).map((e) => ({ title: e.title, body: truncateWords(e.body, 18) })),
    takeaway: truncateWords(report.page2.takeaway, 30),
    tldrSg: truncateWords(report.page2.tldr_sg, 30),
    pulse: report.page2.pulse.map((p) => ({ label: p.label, symbol: p.symbol, changePct: p.changePct, outcome: p.outcome })),
    sources: resolveSources(report.sources_used, report.source_urls),
  };
}

export function mapPage3(report: ReportDataV2): Page3Data {
  // Cap row counts too — the table height is the binding constraint on page 3
  // (7 regions + 5 sectors is the tested worst case that still fits).
  return {
    regions: report.page3.regions.slice(0, 7).map((r) => ({ name: r.name, rating: r.rating, stars: r.stars, reason: truncateWords(r.reason, 20) })),
    sectors: report.page3.sectors.slice(0, 5).map((s) => ({ name: s.name, rating: s.rating, stars: s.stars, reason: truncateWords(s.reason, 20) })),
    sources: resolveSources(report.sources_used, report.source_urls),
  };
}

export function mapPage4(report: ReportDataV2): Page4Data {
  const d = report.page4.distributions;
  return {
    introText: truncateWords(report.page4.intro_text, 46),
    funds: [
      toFundCard("PIMCO GIS Income Fund", "PIMCO Income", report.page4.pimco, d.pimco, "pimco"),
      toFundCard("Allianz Income and Growth", "Allianz I&G", report.page4.allianz, d.allianz, "allianz"),
      toFundCard("FSSA Dividend Advantage Fund A QDIS SGD", "FSSA Div Adv", report.page4.fssa, d.fssa, "fssa"),
      toFundCard("GreatLink Global Real Estate Securities Fund", "GreatLink GRES", report.page4.greatlink, d.greatlink, "greatlink"),
    ],
  };
}

export function mapPage5(report: ReportDataV2): Page5Data {
  return {
    opportunities: report.page5.opportunities.slice(0, 3).map((o) => {
      const series = report.page5.chart_series[o.chart_symbol_key];
      return {
        name: truncateWords(o.name, 6),
        whyItMatters: truncateWords(o.why_it_matters, 22),
        analysis: truncateWords(o.analysis, 30),
        mainRisk: truncateWords(o.main_risk, 22),
        whatToWatch: truncateWords(o.what_to_watch, 22),
        chartLabel: series?.label ?? "",
        chartData: series?.closes.length ? series.closes : [100, 100],
        chartChangePct: series?.changePct ?? null,
      };
    }),
    reminders: report.page5.reminders.slice(0, 3),
    macroBackdrop: mapMacroBackdrop(report),
    sources: resolveSources(report.sources_used, report.source_urls),
  };
}

export function mapPage6(report: ReportDataV2): Page6Data {
  return {
    summary: truncateWords(report.page6.summary, 48),
    watching: report.page6.watching.slice(0, 3).map((t) => truncateWords(t, 12)),
    mayCreateOpportunity: report.page6.may_create_opportunity.slice(0, 3).map((t) => truncateWords(t, 12)),
    avoid: report.page6.avoid.slice(0, 3).map((t) => truncateWords(t, 12)),
    benchmarks: report.page6.benchmarks,
    watchlist: report.page6.watchlist.slice(0, 5).map((w) => ({ theme: w.theme, note: truncateWords(w.note, 14) })),
    closingMessage: truncateWords(report.page6.closing_message, 26),
  };
}
