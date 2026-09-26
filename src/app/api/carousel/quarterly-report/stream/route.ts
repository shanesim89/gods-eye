import { requireUser } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { gatherSourcesV2 } from "@/lib/market-outlook/firecrawl";
import { generateReportV2 } from "@/lib/market-outlook/generate-v2";
import {
  getMarketPulse,
  getBenchmarks,
  getChartSeries,
  resolveFundDistributions,
  getIndexHeatmap,
  getYieldCurve,
  getVixGauge,
} from "@/lib/market-outlook/market-data";
import type { OutlookStreamEventV2, ReportFilters, ChartSymbolKey, ChartSeriesV2 } from "@/lib/market-outlook/types";
import { REGIONS, SECTORS, TONES, PERIODS, CHART_SYMBOL_KEYS, pickMacroBackdropType } from "@/lib/market-outlook/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sse(event: OutlookStreamEventV2): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const SSE_PING = ": keep-alive\n\n";

type Body = {
  filters?: Partial<ReportFilters>;
  brand?: { firmName?: string; adviserName?: string; adviserTitle?: string };
};

function parseFilters(raw: Body["filters"]): ReportFilters {
  const regions = (raw?.regions ?? []).filter((r): r is (typeof REGIONS)[number] => (REGIONS as readonly string[]).includes(r));
  const sectors = (raw?.sectors ?? []).filter((s): s is (typeof SECTORS)[number] => (SECTORS as readonly string[]).includes(s));
  const tone = (TONES as readonly string[]).includes(raw?.tone ?? "") ? (raw!.tone as (typeof TONES)[number]) : "neutral";
  const period = (PERIODS as readonly string[]).includes(raw?.period ?? "") ? (raw!.period as (typeof PERIODS)[number]) : "quarterly";
  return { regions, sectors, tone, period };
}

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: OutlookStreamEventV2) => {
        controller.enqueue(encoder.encode(sse(event)));
      };

      const pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(SSE_PING));
        } catch {
          /* controller closed */
        }
      }, 5000);

      try {
        await requireUser();

        const body = (await req.json()) as Body;
        const filters = parseFilters(body.filters);
        const brand = {
          firmName: (body.brand?.firmName ?? "").trim(),
          adviserName: (body.brand?.adviserName ?? "").trim(),
          adviserTitle: (body.brand?.adviserTitle ?? "").trim(),
        };

        // Picked first (pure, no I/O) since it determines what page5 data to
        // fetch below and what schema/prompt to send the model — same
        // reshuffle-per-generation pattern as the cover photo.
        const macroType = pickMacroBackdropType();

        emit({ type: "status", stage: "scraping" });
        const sourcesPromise = gatherSourcesV2(filters, emit);

        emit({ type: "status", stage: "market-data" });
        const [sources, pulse, benchmarks, macroIndexHeatmap, macroYieldCurve, macroVixGauge] = await Promise.all([
          sourcesPromise,
          getMarketPulse(),
          getBenchmarks(),
          macroType === "index_heatmap" ? getIndexHeatmap() : Promise.resolve(null),
          macroType === "yield_curve" ? getYieldCurve() : Promise.resolve(null),
          macroType === "vix_gauge" ? getVixGauge() : Promise.resolve(null),
        ]);

        const okCount = sources.filter((s) => s.ok).length;
        if (okCount < 2) {
          emit({ type: "error", message: "Couldn't fetch enough market sources — Firecrawl may be down. Try again in a minute." });
          controller.close();
          return;
        }

        emit({ type: "status", stage: "drafting" });
        const anthropic = new Anthropic();
        // Any fund whose yield or quarter move didn't come through on the
        // first scrape gets re-scraped here, in parallel with the ~30s+
        // drafting call — retries are "free" wall-clock time this way rather
        // than adding to the pipeline (which is already close to the 60s cap).
        const [report, distributions] = await Promise.all([
          generateReportV2(filters, brand, sources, anthropic, macroType),
          resolveFundDistributions(sources, emit),
        ]);

        // Fetch the real series backing whichever chart_symbol_key each
        // opportunity picked — dedupe so we only fetch each symbol once.
        const usedKeys = Array.from(new Set(report.page5.opportunities.map((o) => o.chart_symbol_key)));
        const seriesEntries = await Promise.all(
          usedKeys.map(async (key) => [key, await getChartSeries(key)] as const)
        );
        const chartSeries = Object.fromEntries(seriesEntries) as Record<ChartSymbolKey, ChartSeriesV2>;
        // Fill any unused keys with an empty series so the type stays total.
        for (const key of CHART_SYMBOL_KEYS) {
          if (!chartSeries[key]) chartSeries[key] = { closes: [], changePct: null, label: "" };
        }

        // Real name -> URL map for every source that actually scraped ok this
        // run — lets each page's footer/inline links point at what actually
        // fed the single shared drafting call, instead of the old
        // hand-authored (and inaccurate) sourceLine strings.
        report.source_urls = Object.fromEntries(
          sources.filter((s) => s.ok && /^https?:\/\//.test(s.url)).map((s) => [s.name, s.url])
        );

        report.page2.pulse = pulse;
        report.page4.distributions = distributions;
        report.page5.chart_series = chartSeries;
        if (macroIndexHeatmap) report.page5.index_heatmap = macroIndexHeatmap;
        if (macroYieldCurve) report.page5.yield_curve = macroYieldCurve;
        if (macroVixGauge) report.page5.vix_gauge = macroVixGauge;
        report.page6.benchmarks = benchmarks;

        emit({ type: "report", data: report });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        console.error("[market-outlook/stream] fatal", err);
        controller.enqueue(encoder.encode(sse({ type: "error", message })));
        controller.close();
      } finally {
        clearInterval(pingTimer);
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
