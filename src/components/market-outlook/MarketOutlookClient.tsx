// ssr:false because the cover photo is picked with Math.random() — a real
// SSR pass would pick a different photo than the client hydration pass and
// trigger a hydration-mismatch error, so this whole page is client-only
// (see src/app/market-outlook/page.tsx).
"use client";
import { useCallback, useMemo, useState } from "react";
import { reportDisplay, reportBody } from "@/components/market-outlook/report/fonts";
import { CoverPage } from "@/components/market-outlook/report/CoverPage";
import { Page2Quarter, type Page2Data } from "@/components/market-outlook/report/Page2Quarter";
import { Page3Value, type Page3Data } from "@/components/market-outlook/report/Page3Value";
import { Page4Income, type Page4Data } from "@/components/market-outlook/report/Page4Income";
import { Page5Opportunities, type Page5Data } from "@/components/market-outlook/report/Page5Opportunities";
import { Page6Ahead, type Page6Data } from "@/components/market-outlook/report/Page6Ahead";
import { SourceLinks } from "@/components/market-outlook/report/SourceLinks";
import { PagedCarousel } from "@/components/market-outlook/report/PagedCarousel";
import { FIXED_SCRAPES, FUND_SCRAPES } from "@/lib/market-outlook/sources";
import { ReportSettings } from "@/components/market-outlook/ReportSettings";
import { DownloadPdfButtonV2 } from "@/components/market-outlook/DownloadPdfButtonV2";
import { randomCoverPhoto, type CoverPhoto } from "@/lib/market-outlook/covers";
import { randomClosingQuote } from "@/lib/market-outlook/closing-quotes";
import { mapPage2, mapPage3, mapPage4, mapPage5, mapPage6 } from "@/lib/market-outlook/map-report-v2";
import { loadBrandSettings, type BrandSettings, type OutlookStreamEventV2, type ReportDataV2 } from "@/lib/market-outlook/types";

const TOTAL = 6;
const PAGE_LABELS = ["1 · Cover", "2 · The Quarter", "3 · Where We See Value", "4 · Income Funds", "5 · Opportunities", "6 · Looking Ahead"];

// Deterministic-looking illustrative series for the placeholder sample only —
// a real generate() call gets real series from market-data.ts instead.
function series(base: number, points: number, drift: number, vol: number): number[] {
  let v = base;
  const out = [v];
  for (let i = 1; i < points; i++) {
    const wobble = Math.sin(i * 1.7) * vol + Math.cos(i * 0.9) * vol * 0.6;
    v = v * (1 + drift / points) + wobble;
    out.push(v);
  }
  return out;
}

const SAMPLE_ISSUE_LABEL = "Quarterly Investment Update · Q2 2026";

// Illustrative sample pages (shown before the first real generation) cite the
// real FIXED_SCRAPES/FUND_SCRAPES sources — same accurate links a real report
// would resolve to, not placeholder text.
const SAMPLE_SOURCES = FIXED_SCRAPES.map((s) => ({ name: s.name, url: s.url }));
function fundUrl(key: (typeof FUND_SCRAPES)[number]["key"]): string {
  return FUND_SCRAPES.find((s) => s.key === key)!.url;
}

const SAMPLE_PAGE2: Page2Data = {
  overview:
    "Resilient growth and easing inflation gave central banks room to hold policy steady rather than cut. Equities pushed to fresh highs on strong earnings, while bonds stayed calm. Tariff rhetoric stirred brief volatility, gold kept climbing, and Asian markets were mixed as China's property strains offset gains elsewhere.",
  events: [
    { title: "Rate path stays gradual", body: "Central banks held steady, signalling a cautious, data-dependent approach to further moves." },
    { title: "Growth holds, inflation cools", body: "Growth stayed resilient while inflation eased toward central-bank targets across most developed markets." },
    { title: "Trade policy back in focus", body: "Renewed tariff talk added volatility, though the broad market impact stayed contained." },
  ],
  pulse: [
    { label: "Global shares", symbol: "^GSPC", changePct: 4.2, outcome: "Positive" },
    { label: "Asian shares", symbol: "AAXJ", changePct: -1.1, outcome: "Mixed" },
    { label: "Global bonds", symbol: "AGG", changePct: 0.6, outcome: "Stable" },
    { label: "Gold", symbol: "GC=F", changePct: 6.8, outcome: "Positive" },
  ],
  takeaway: "A mixed quarter — staying diversified and disciplined beats reacting to every short-term headline.",
  tldrSg: "Market gao gao a bit lah, but no need kan cheong — stay diversified, don't panic-sell, steady wins.",
  sources: SAMPLE_SOURCES,
};

const SAMPLE_PAGE3: Page3Data = {
  regions: [
    { name: "United States", rating: "attractive", stars: 4, reason: "Earnings growth stayed broad-based across sectors beyond the largest technology names." },
    { name: "Europe", rating: "neutral", stars: 3, reason: "Valuations look reasonable but growth remains modest against a mixed policy backdrop." },
    { name: "Japan", rating: "attractive", stars: 4, reason: "Improving company profits and shareholder returns may support the market." },
    { name: "China", rating: "less attractive", stars: 2, reason: "Property-sector strains and uneven consumer demand continue to weigh on sentiment." },
    { name: "Asia ex-Japan", rating: "attractive", stars: 4, reason: "Corporate governance reform and rising shareholder returns support a more constructive regional view." },
    { name: "Singapore", rating: "attractive", stars: 4, reason: "Resilient banking-sector earnings and stable policy continue to underpin the local market." },
    { name: "ASEAN & emerging markets", rating: "neutral", stars: 3, reason: "Diverging growth stories across countries make a single broad call difficult." },
  ],
  sectors: [
    { name: "Technology", rating: "attractive", stars: 5, reason: "Continued investment in AI infrastructure supports the broader sector outlook." },
    { name: "Healthcare", rating: "neutral", stars: 3, reason: "Defensive characteristics remain appealing amid policy uncertainty on drug pricing." },
    { name: "Financials", rating: "attractive", stars: 4, reason: "Healthy balance sheets and a steady rate backdrop continue to support earnings." },
    { name: "Property (REITs)", rating: "less attractive", stars: 2, reason: "Elevated financing costs continue to pressure valuations in most regions." },
    { name: "Consumer", rating: "neutral", stars: 3, reason: "Spending has held up but shows signs of increasing selectivity among households." },
  ],
  sources: SAMPLE_SOURCES,
};

const SAMPLE_PAGE4: Page4Data = {
  introText: "A steady income stream can matter as much as growth, especially for clients drawing on their portfolio. These four funds take different paths there — bonds, dividend equities, and real estate.",
  funds: [
    {
      name: "PIMCO GIS Income Fund",
      ticker: "PIMCO Income",
      purpose: "Seeks a steady stream of income by investing across the full spectrum of global fixed-income markets.",
      incomeSources: ["Government bonds", "Mortgage-related", "Corporate bonds"],
      whatChanged: "A modest increase in mortgage-related exposure this quarter, funded by trimming lower-yielding government bonds.",
      yieldPct: 6.8,
      frequency: "Monthly",
      verified: true,
      quarterChangePct: 1.4,
      sourceUrl: fundUrl("pimco"),
    },
    {
      name: "Allianz Income and Growth",
      ticker: "Allianz I&G",
      purpose: "Combines dividend-paying equities with high-yield and convertible bonds, aiming for both income and long-term growth.",
      incomeSources: ["Equities", "High-yield bonds", "Convertible bonds"],
      whatChanged: "Equity allocation nudged higher this quarter, leaning into improving corporate earnings and dividend growth.",
      yieldPct: 7.31,
      frequency: "Monthly",
      verified: true,
      quarterChangePct: 5.27,
      sourceUrl: fundUrl("allianz"),
    },
    {
      name: "FSSA Dividend Advantage Fund A QDIS SGD",
      ticker: "FSSA Div Adv",
      purpose: "Invests in Asia Pacific ex-Japan equities with potential for dividend growth and long-term capital appreciation.",
      incomeSources: ["Asia Pacific ex-Japan equities"],
      whatChanged: "Regional positioning stayed broadly steady this quarter, with quarterly distributions from income, capital gains and/or capital.",
      yieldPct: 3.33,
      frequency: "Quarterly",
      verified: true,
      quarterChangePct: 2.0,
      sourceUrl: fundUrl("fssa"),
    },
    {
      name: "GreatLink Global Real Estate Securities Fund",
      ticker: "GreatLink GRES",
      purpose: "Invests globally in real estate equities and REITs, aiming for medium- to long-term capital growth and regular income distributions.",
      incomeSources: ["Global REITs", "Real estate equities"],
      whatChanged: "Continued diversified exposure across global real estate securities and REITs this quarter.",
      yieldPct: 3.3,
      frequency: "Annually",
      verified: true,
      quarterChangePct: 4.96,
      sourceUrl: fundUrl("greatlink"),
    },
  ],
};

const SAMPLE_PAGE5: Page5Data = {
  opportunities: [
    {
      name: "Quality bonds",
      whyItMatters: "Income levels may remain appealing, although renewed inflation could pressure bond prices.",
      analysis: "Investment-grade yields sit near decade highs even as central banks near the end of their tightening cycles — a combination that has historically favoured fixed income.",
      mainRisk: "A resurgence in inflation could push yields higher and prices lower.",
      whatToWatch: "Central bank commentary on the pace of future rate moves.",
      chartLabel: "Investment-grade bond index, past 12 months",
      chartData: series(100, 26, 0.03, 0.6),
      chartChangePct: 3.8,
    },
    {
      name: "Dividend strategies",
      whyItMatters: "Companies with a history of steady payouts may offer ballast during choppier markets.",
      analysis: "Dividend growers have historically shown lower drawdowns in volatile quarters, and payout coverage across large-cap dividend payers remains comfortably above long-run averages.",
      mainRisk: "Rate-sensitive dividend payers can lag in a rapidly rising-rate environment.",
      whatToWatch: "Payout ratios and free cash flow trends across dividend leaders.",
      chartLabel: "Global dividend index, past 12 months",
      chartData: series(100, 26, 0.05, 0.7),
      chartChangePct: 5.9,
    },
    {
      name: "Selected Asian markets",
      whyItMatters: "Improving corporate governance and shareholder returns support a more constructive view.",
      analysis: "Buyback and dividend reforms across several Asian markets have lifted shareholder returns, even as headline growth figures remain uneven across the region.",
      mainRisk: "Regional growth remains uneven and sensitive to trade-policy headlines.",
      whatToWatch: "Export data and domestic consumption trends over the coming quarter.",
      chartLabel: "Asia ex-Japan equities, past 12 months",
      chartData: series(100, 26, -0.01, 0.9),
      chartChangePct: -1.1,
    },
  ],
  reminders: ["Stay invested", "Invest gradually", "Keep diversified"],
  macroBackdrop: {
    type: "cycle",
    positions: [
      { region: "United States", code: "US", phasePct: 42 },
      { region: "Europe", code: "EU", phasePct: 22 },
      { region: "Japan", code: "JP", phasePct: 15 },
      { region: "China", code: "CN", phasePct: 8 },
      { region: "Asia ex-Japan", code: "AX", phasePct: 58 },
      { region: "Singapore", code: "SG", phasePct: 48 },
      { region: "Emerging Markets", code: "EM", phasePct: 70 },
    ],
  },
  sources: SAMPLE_SOURCES,
};

const SAMPLE_PAGE6: Page6Data = {
  summary: "History rewards clients who stay invested and stick to their strategy over timing markets around headlines. Opportunity tends to be everywhere — the task is finding sectors that align with your own goals and risk tolerance.",
  benchmarks: [
    { label: "S&P 500", price: "5,432", changePct: 4.2, url: "https://finance.yahoo.com/quote/%5EGSPC" },
    { label: "MSCI Asia ex-Japan", price: "812", changePct: -1.1, url: "https://finance.yahoo.com/quote/AAXJ" },
    { label: "US 10-Year Treasury yield", price: "4.28%", changePct: null, url: "https://finance.yahoo.com/quote/%5ETNX" },
    { label: "Gold (per oz)", price: "US$2,410", changePct: 6.8, url: "https://finance.yahoo.com/quote/GC%3DF" },
    { label: "USD/SGD", price: "1.29", changePct: -0.3, url: "https://finance.yahoo.com/quote/SGD%3DX" },
  ],
  watchlist: [
    { theme: "Quality income", note: "Investment-grade credit at yields not seen in over a decade." },
    { theme: "AI infrastructure", note: "Continued capex cycle across cloud and semiconductor supply chains." },
    { theme: "Healthcare innovation", note: "Defensive earnings with pockets of genuine structural growth." },
    { theme: "Japan reform", note: "Governance reform continuing to lift shareholder returns." },
    { theme: "Financials", note: "Healthy balance sheets against a steadier rate backdrop." },
  ],
  watching: ["Inflation and interest-rate decisions", "Economic growth momentum", "Corporate earnings through the next reporting season"],
  mayCreateOpportunity: ["Market pullbacks that reset valuations", "Higher-quality income assets", "Stronger earnings growth outside recent market leaders"],
  avoid: ["Chasing recent winners", "Making decisions based on one headline", "Concentrating heavily in one market"],
  closingMessage: randomClosingQuote(),
};

type GenState = "idle" | "scraping" | "market-data" | "drafting" | "done" | "error";

export default function MarketOutlookClient() {
  // `brand` is the live form draft (every keystroke); `appliedBrand` is what's
  // actually shown on the pages — only synced from `brand` when Update Input
  // or Refresh PDF is clicked, so typing doesn't re-render the report per key.
  const [brand, setBrand] = useState<BrandSettings>(() => loadBrandSettings());
  const [appliedBrand, setAppliedBrand] = useState<BrandSettings>(brand);
  const [report, setReport] = useState<ReportDataV2 | null>(null);
  const [genState, setGenState] = useState<GenState>("idle");
  const [genError, setGenError] = useState<string | null>(null);
  const [sourceChips, setSourceChips] = useState<{ name: string; ok: boolean }[]>([]);
  const [retryLog, setRetryLog] = useState<{ keys: string[]; attempt: number; maxAttempts: number }[]>([]);
  // Re-shuffled on every Refresh PDF so the cover photo doesn't stay fixed
  // to whatever was picked on first page load.
  const [photo, setPhoto] = useState<CoverPhoto>(() => randomCoverPhoto());

  const adviser = {
    firmName: appliedBrand.firmName,
    adviserName: appliedBrand.adviserName,
    adviserTitle: appliedBrand.adviserTitle,
    phone: appliedBrand.phone,
    email: appliedBrand.email,
    logoDataUrl: appliedBrand.logoDataUrl,
    photoDataUrl: appliedBrand.photoDataUrl,
    // Framing is sourced from the live draft so the sliders adjust the cover
    // portrait in real time, without needing an Update Input click.
    photoPosY: brand.photoPosY,
    photoScale: brand.photoScale,
    photoOpacity: brand.photoOpacity,
  };

  const updateInput = useCallback(() => {
    setAppliedBrand(brand);
  }, [brand]);

  const generate = useCallback(async () => {
    setAppliedBrand(brand);
    setPhoto(randomCoverPhoto());
    setGenState("scraping");
    setGenError(null);
    setSourceChips([]);
    setRetryLog([]);
    setReport(null);

    try {
      const res = await fetch("/api/market-outlook/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: { regions: ["Singapore", "US", "Global"], sectors: [], tone: "reassuring", period: "quarterly" },
          brand: { firmName: brand.firmName, adviserName: brand.adviserName, adviserTitle: brand.adviserTitle },
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (HTTP ${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotTerminal = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const event: OutlookStreamEventV2 = JSON.parse(line.slice(6));
            switch (event.type) {
              case "status":
                setGenState(event.stage);
                break;
              case "source_done":
                // Upsert by name — a fund that fails on the first pass and
                // succeeds on a background retry should update its existing
                // chip, not add a second one.
                setSourceChips((c) => {
                  const i = c.findIndex((x) => x.name === event.name);
                  if (i === -1) return [...c, { name: event.name, ok: event.ok }];
                  const next = [...c];
                  next[i] = { name: event.name, ok: event.ok };
                  return next;
                });
                break;
              case "fund_retry":
                setRetryLog((l) => [...l, { keys: event.keys, attempt: event.attempt, maxAttempts: event.maxAttempts }]);
                break;
              case "report":
                setReport(event.data);
                setGenState("done");
                gotTerminal = true;
                break;
              case "error":
                setGenError(event.message);
                setGenState("error");
                gotTerminal = true;
                break;
            }
          } catch {
            /* ignore malformed SSE chunk */
          }
        }
      }
      if (!gotTerminal) {
        setGenError("Generation timed out — try again.");
        setGenState("error");
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
      setGenState("error");
    }
  }, [brand]);

  const issueLabel = report ? `Quarterly Investment Update · ${report.quarter_label}` : SAMPLE_ISSUE_LABEL;
  const page2Data = useMemo(() => (report ? mapPage2(report) : SAMPLE_PAGE2), [report]);
  const page3Data = useMemo(() => (report ? mapPage3(report) : SAMPLE_PAGE3), [report]);
  const page4Data = useMemo(() => (report ? mapPage4(report) : SAMPLE_PAGE4), [report]);
  const page5Data = useMemo(() => (report ? mapPage5(report) : SAMPLE_PAGE5), [report]);
  const page6Data = useMemo(() => (report ? mapPage6(report) : SAMPLE_PAGE6), [report]);

  // Built twice: `pages` (screen preview — friendly clickable link names,
  // shows VERIFIED/UNVERIFIED as an internal QA signal) and `pdfPages`
  // (download — hides that badge and spells out full URLs instead of
  // friendly names, since a static document can't rely on "click here").
  const buildPages = (forPdf: boolean) => [
    (
      <CoverPage
        key="cover"
        kicker="Market Outlook"
        masthead={report?.cover_theme ?? "Rates Hold, Markets Climb"}
        quarterLabel={report?.quarter_label ?? "Q2 2026"}
        asAtLabel={report?.as_at_label ?? "As at 30 June 2026"}
        subtitle={report?.subtitle ?? "Market recap, income updates and opportunities."}
        photoSrc={photo.src}
        photoLocation={photo.location}
        photoCredit={photo.credit}
        adviser={adviser}
        disclaimer="This update is for general information only and does not constitute financial advice or a recommendation to buy or sell any investment product. Past performance is not indicative of future results."
      />
    ),
    (
      <Page2Quarter
        key="p2"
        issueLabel={issueLabel}
        pageNum={2}
        totalPages={TOTAL}
        sourceLine={
          <SourceLinks
            sources={page2Data.sources}
            fallback="Source: BlackRock Weekly Commentary, Charles Schwab Market Commentary, J.P. Morgan Weekly Market Recap, and aggregated market/economic-calendar news search results."
            forPdf={forPdf}
          />
        }
        data={page2Data}
      />
    ),
    (
      <Page3Value
        key="p3"
        issueLabel={issueLabel}
        pageNum={3}
        totalPages={TOTAL}
        sourceLine={
          <SourceLinks
            sources={page3Data.sources}
            fallback="Source: BlackRock Weekly Commentary, Charles Schwab Market Commentary, J.P. Morgan Weekly Market Recap and aggregated news search results — ratings are a qualitative read of that commentary, not a specific index provider."
            forPdf={forPdf}
          />
        }
        data={page3Data}
      />
    ),
    (
      <Page4Income
        key="p4"
        issueLabel={issueLabel}
        pageNum={4}
        totalPages={TOTAL}
        sourceLine={
          <>
            Source:{" "}
            <a href={fundUrl("pimco")} target="_blank" rel="noopener noreferrer">
              {forPdf ? fundUrl("pimco") : "FSMOne (Fundsupermart)"}
            </a>{" "}
            fund factsheets for PIMCO GIS Income, Allianz Income and Growth and FSSA Dividend Advantage;{" "}
            <a href={fundUrl("greatlink")} target="_blank" rel="noopener noreferrer">
              {forPdf ? fundUrl("greatlink") : "Great Eastern ILP Fund Centre"}
            </a>{" "}
            for GreatLink Global Real Estate Securities Fund — see each fund card above for its exact source.
          </>
        }
        data={page4Data}
        hideVerifiedBadge={forPdf}
        forPdf={forPdf}
      />
    ),
    (
      <Page5Opportunities
        key="p5"
        issueLabel={issueLabel}
        pageNum={5}
        totalPages={TOTAL}
        sourceLine={
          page5Data.sources.length > 0 ? (
            <>
              <SourceLinks sources={page5Data.sources} fallback="" forPdf={forPdf} />, and{" "}
              <a href="https://finance.yahoo.com" target="_blank" rel="noopener noreferrer">
                {forPdf ? "https://finance.yahoo.com" : "Yahoo Finance"}
              </a>{" "}
              market data.
            </>
          ) : (
            <>
              Source: BlackRock Weekly Commentary, Charles Schwab Market Commentary, J.P. Morgan Weekly Market Recap, aggregated news search results, and{" "}
              <a href="https://finance.yahoo.com" target="_blank" rel="noopener noreferrer">
                {forPdf ? "https://finance.yahoo.com" : "Yahoo Finance"}
              </a>{" "}
              market data.
            </>
          )
        }
        data={page5Data}
      />
    ),
    (
      <Page6Ahead
        key="p6"
        adviser={adviser}
        issueLabel={issueLabel}
        pageNum={6}
        totalPages={TOTAL}
        sourceLine={
          <>
            This update is for general information only and does not constitute financial advice. Benchmark data as
            at quarter-end, sourced from{" "}
            <a href="https://finance.yahoo.com" target="_blank" rel="noopener noreferrer">
              {forPdf ? "https://finance.yahoo.com" : "Yahoo Finance"}
            </a>
            .
          </>
        }
        data={page6Data}
      />
    ),
  ];

  const pages = buildPages(false);
  const pdfPages = buildPages(true);

  const busy = genState === "scraping" || genState === "market-data" || genState === "drafting";
  const refreshLabel: Record<GenState, string> = {
    idle: "REFRESH PDF",
    scraping: "SCRAPING SOURCES…",
    "market-data": "FETCHING MARKET DATA…",
    drafting: "DRAFTING WITH CLAUDE…",
    done: "REFRESH PDF",
    error: "RETRY REFRESH",
  };
  const STAGE_ORDER: GenState[] = ["scraping", "market-data", "drafting"];
  const stageIndex = STAGE_ORDER.indexOf(genState);

  return (
    <div
      className={`${reportDisplay.variable} ${reportBody.variable}`}
      style={{ height: "100%", width: "100%", display: "flex", background: "#20262e" }}
    >
      <div
        style={{
          width: "25%",
          minWidth: 280,
          maxWidth: 380,
          borderRight: "1px solid #2b333d",
          padding: 18,
          overflowY: "auto",
          background: "#191f27",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: 1.5, color: "#4fc7be" }}>REPORT DETAILS</div>
        <ReportSettings value={brand} onChange={setBrand} />

        <button
          onClick={updateInput}
          disabled={busy}
          style={{
            marginTop: 4,
            padding: "10px 14px",
            background: "transparent",
            color: busy ? "#556170" : "#e7edf3",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 1,
            border: "1px solid #3a4552",
            borderRadius: 3,
            cursor: busy ? "default" : "pointer",
          }}
        >
          UPDATE INPUT
        </button>

        <button
          onClick={generate}
          disabled={busy}
          style={{
            padding: "10px 14px",
            background: busy ? "#2b333d" : "#4fc7be",
            color: busy ? "#8093a1" : "#0a1a2c",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 1,
            border: "none",
            borderRadius: 3,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {refreshLabel[genState]}
        </button>

        <DownloadPdfButtonV2 pages={pdfPages} filenamePrefix="market-outlook" />

        {busy && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 3 }}>
              {STAGE_ORDER.map((stage, i) => (
                <div
                  key={stage}
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    background: i < stageIndex ? "#4fc7be" : i === stageIndex ? "#4fc7be" : "#2b333d",
                    opacity: i === stageIndex ? 0.55 : 1,
                    animation: i === stageIndex ? "outlookPulse 1.1s ease-in-out infinite" : undefined,
                  }}
                />
              ))}
            </div>
            <style>{`@keyframes outlookPulse { 0%,100% { opacity: 0.35; } 50% { opacity: 0.9; } }`}</style>
          </div>
        )}

        {sourceChips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 10, fontFamily: "monospace" }}>
            {sourceChips.map((c, i) => (
              <span key={i} style={{ color: c.ok ? "#4fc7be" : "#c0392b" }}>
                {c.ok ? "✓" : "✕"} {c.name}
              </span>
            ))}
          </div>
        )}

        {retryLog.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              fontSize: 9.5,
              fontFamily: "monospace",
              color: "#8093a1",
              border: "1px solid #2b333d",
              borderRadius: 3,
              padding: "6px 8px",
              maxHeight: 110,
              overflowY: "auto",
            }}
          >
            {retryLog.map((r, i) => (
              <div key={i}>
                <span style={{ color: "#e0a94f" }}>⟳</span> Retrying {r.keys.join(", ")} — attempt {r.attempt}/{r.maxAttempts}
              </div>
            ))}
          </div>
        )}

        {genError && (
          <div style={{ border: "1px solid #c0392b", color: "#e08a80", fontSize: 11, padding: 8, borderRadius: 3 }}>
            {genError}
          </div>
        )}

        {genState === "done" && (
          <div style={{ fontSize: 10, color: "#4fc7be", fontFamily: "monospace" }}>✓ Report generated — showing live data.</div>
        )}
        {genState === "idle" && (
          <div style={{ fontSize: 10, color: "#6b7885" }}>Showing illustrative sample data. Click Refresh PDF for a real report.</div>
        )}
      </div>

      <div style={{ width: "75%", padding: "16px 20px" }}>
        <PagedCarousel pages={pages} labels={PAGE_LABELS} />
      </div>
    </div>
  );
}
