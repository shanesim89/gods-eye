// Shared types for the Market Outlook client-report generator.
// No DB involvement — reports are generate-and-forget; branding lives in localStorage.

export const REGIONS = ["US", "Europe", "China", "Singapore", "Global"] as const;
export type Region = (typeof REGIONS)[number];

export const SECTORS = [
  "Technology",
  "Energy",
  "REITs",
  "Healthcare",
  "Financials",
  "Consumer",
  "Industrials",
] as const;
export type Sector = (typeof SECTORS)[number];

export const TONES = ["reassuring", "neutral"] as const;
export type Tone = (typeof TONES)[number];

export const PERIODS = ["bi-weekly", "quarterly"] as const;
export type Period = (typeof PERIODS)[number];

export type ReportFilters = {
  regions: Region[];
  sectors: Sector[];
  tone: Tone;
  period: Period;
};

// Branding — persisted client-side only (localStorage). Only the name fields are
// sent to the API (for the WhatsApp sign-off); the logo never leaves the browser.
export type BrandSettings = {
  firmName: string;
  adviserName: string;
  adviserTitle: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  /** Passport-style adviser photo, background already removed (PNG w/ alpha). */
  photoDataUrl: string | null;
  /** Cover portrait framing — vertical position (0-100%, currently unused by
   *  the overlay treatment but kept for a future crop control) and zoom
   *  (80-160%). */
  photoPosY: number;
  photoScale: number;
  /** Cover portrait opacity (30-100%) — how strongly the photo blends into
   *  the cover photo behind it. */
  photoOpacity: number;
  accentColor: string;
};

export const DEFAULT_BRAND: BrandSettings = {
  firmName: "Advisors' Clique - ACDC Group",
  adviserName: "",
  adviserTitle: "",
  phone: "",
  email: "",
  logoDataUrl: "/acdc-logo.png",
  photoDataUrl: null,
  photoPosY: 50,
  photoScale: 100,
  photoOpacity: 78,
  accentColor: "#1a5276",
};

export const BRAND_STORAGE_KEY = "market-outlook:settings:v1";

export function loadBrandSettings(): BrandSettings {
  if (typeof window === "undefined") return DEFAULT_BRAND;
  try {
    const raw = window.localStorage.getItem(BRAND_STORAGE_KEY);
    if (!raw) return DEFAULT_BRAND;
    return { ...DEFAULT_BRAND, ...(JSON.parse(raw) as Partial<BrandSettings>) };
  } catch {
    return DEFAULT_BRAND;
  }
}

export function saveBrandSettings(s: BrandSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota exceeded — logo too big despite downscale; ignore */
  }
}

// A scraped (or failed) source fed to the drafting model.
export type ScrapedSource = {
  name: string;
  url: string;
  ok: boolean;
  markdown?: string;
};

// ── The 6-page quarterly report schema ──────────────────────────────────────
// Mirrors the record_report_v2 tool schema. Market pulse (page 2) and
// benchmarks (page 6) are NOT part of this — they're fetched live from Yahoo
// (src/lib/market-outlook/market-data.ts) and merged in server-side, never
// invented by the model.

export type Rating = "attractive" | "neutral" | "less attractive";

export type ValueItemV2 = {
  name: string;
  rating: Rating;
  stars: number; // 1-5
  reason: string;
};

// Model-written narrative only — all fund NUMBERS now come server-side
// (parseFundDistributions in market-data.ts), never invented by the model.
export type FundNarrativeV2 = {
  purpose: string;
  income_sources: string[];
  what_changed: string;
};

export const FUND_KEYS = ["pimco", "allianz", "fssa", "greatlink"] as const;
export type FundKey = (typeof FUND_KEYS)[number];

// Server-parsed distribution figures scraped deterministically from the fund's
// dealer/factsheet page (verified = the regex actually matched a number).
export type FundDistributionV2 = {
  yieldPct: number | null;
  frequency: string | null; // "Monthly" | "Quarterly" | "Annually" | …
  verified: boolean;
  quarterChangePct: number | null; // 3-month NAV/price return, from the same factsheet scrape
};

// Real series we fetch server-side (src/lib/market-outlook/market-data.ts) —
// the model picks which one backs each opportunity's chart, it never invents data.
export const CHART_SYMBOL_KEYS = ["AGG", "VYM", "AAXJ", "SPX", "GOLD"] as const;
export type ChartSymbolKey = (typeof CHART_SYMBOL_KEYS)[number];

export type OpportunityV2 = {
  name: string;
  why_it_matters: string;
  analysis: string;
  main_risk: string;
  what_to_watch: string;
  chart_symbol_key: ChartSymbolKey;
};

// ── Page-5 "macro backdrop" — a rotating panel, one of six chart types
// picked at random per generation (pickMacroBackdropType), same shuffle
// pattern as the cover photo. Three types are AI-judged from the scraped
// sources (schema below), three are real Yahoo data merged in server-side —
// the model never sees or fills those three.

export const MACRO_BACKDROP_TYPES = ["cycle", "index_heatmap", "yield_curve", "growth_inflation", "central_bank", "vix_gauge"] as const;
export type MacroBackdropType = (typeof MACRO_BACKDROP_TYPES)[number];

export function pickMacroBackdropType(): MacroBackdropType {
  return MACRO_BACKDROP_TYPES[Math.floor(Math.random() * MACRO_BACKDROP_TYPES.length)];
}

// Fixed rosters (not model-chosen) so each chart's layout/bubble count never
// shifts quarter to quarter — mirrors page3's fixed "Asia ex-Japan"/"Singapore" precedent.
export const CYCLE_REGIONS = [
  { key: "us", label: "United States", code: "US" },
  { key: "europe", label: "Europe", code: "EU" },
  { key: "japan", label: "Japan", code: "JP" },
  { key: "china", label: "China", code: "CN" },
  { key: "asia_ex_japan", label: "Asia ex-Japan", code: "AX" },
  { key: "singapore", label: "Singapore", code: "SG" },
  { key: "emerging_markets", label: "Emerging Markets", code: "EM" },
] as const;
export type CycleRegionKey = (typeof CYCLE_REGIONS)[number]["key"];
export type CyclePositionV2 = { region: CycleRegionKey; phase_pct: number }; // 0-100: 0-25 Early, 25-50 Mid, 50-75 Late, 75-100 Recession

export const QUADRANT_ASSETS = ["Equities", "Bonds", "Gold", "Commodities", "REITs", "Cash"] as const;
export type QuadrantAsset = (typeof QUADRANT_ASSETS)[number];
export type QuadrantPositionV2 = { asset: QuadrantAsset; growth: number; inflation: number }; // each -100..100

export const CENTRAL_BANKS = [
  { key: "fed", label: "Federal Reserve" },
  { key: "ecb", label: "ECB" },
  { key: "boj", label: "Bank of Japan" },
  { key: "mas", label: "MAS" },
] as const;
export type CentralBankKey = (typeof CENTRAL_BANKS)[number]["key"];
export type CentralBankStance = "hiking" | "holding" | "cutting";
export type CentralBankStanceV2 = { bank: CentralBankKey; stance: CentralBankStance; note: string };

// Real, server-fetched (never model-generated) — see market-data.ts.
export type IndexHeatmapEntryV2 = { symbol: string; label: string; changePct: number };
export type YieldCurvePointV2 = { tenor: string; symbol: string; yieldPct: number };
export type VixGaugeDataV2 = { value: number; level: "low" | "neutral" | "elevated" | "high" };

// Real, server-fetched (never model-generated) market data merged into the
// final payload — see src/lib/market-outlook/market-data.ts.
export type MarketPulseOutcome = "Positive" | "Mixed" | "Stable" | "Negative";
export type MarketPulseAreaV2 = { label: string; symbol: string; changePct: number | null; outcome: MarketPulseOutcome };
export type BenchmarkRowV2 = { label: string; price: string; changePct: number | null; url: string | null };
export type ChartSeriesV2 = { closes: number[]; changePct: number | null; label: string };

export type ReportDataV2 = {
  quarter_label: string; // "Q2 2026"
  as_at_label: string; // "As at 30 June 2026"
  subtitle: string;
  cover_theme: string; // punchy 2-5 word magazine-style headline capturing the quarter's key economic story
  page2: {
    overview: string;
    events: { title: string; body: string }[]; // exactly 3
    takeaway: string; // <= 35 words
    tldr_sg: string; // <= 35 words, casual Singaporean/Singlish-flavoured version of the takeaway
    pulse: MarketPulseAreaV2[]; // server-fetched, merged in after model call
  };
  page3: {
    regions: ValueItemV2[]; // 5-7, must include Asia ex-Japan and Singapore
    sectors: ValueItemV2[]; // 4-5
  };
  page4: {
    intro_text: string;
    pimco: FundNarrativeV2;
    allianz: FundNarrativeV2;
    fssa: FundNarrativeV2;
    greatlink: FundNarrativeV2;
    distributions: Record<FundKey, FundDistributionV2>; // server-parsed, merged in after model call
  };
  page5: {
    opportunities: OpportunityV2[]; // exactly 3
    reminders: string[]; // exactly 3
    chart_series: Record<ChartSymbolKey, ChartSeriesV2>; // server-fetched, keyed for each opportunity's chart_symbol_key
    macro_type: MacroBackdropType; // chosen server-side before generation (pickMacroBackdropType), echoed back so the client knows which macro-backdrop branch to render
    cycle_positions?: CyclePositionV2[]; // AI-judged, present only when macro_type === "cycle"
    quadrant_positions?: QuadrantPositionV2[]; // AI-judged, present only when macro_type === "growth_inflation"
    central_bank_stances?: CentralBankStanceV2[]; // AI-judged, present only when macro_type === "central_bank"
    index_heatmap?: IndexHeatmapEntryV2[]; // server-fetched, present only when macro_type === "index_heatmap"
    yield_curve?: YieldCurvePointV2[]; // server-fetched, present only when macro_type === "yield_curve"
    vix_gauge?: VixGaugeDataV2; // server-fetched, present only when macro_type === "vix_gauge"
  };
  page6: {
    summary: string;
    watching: string[]; // exactly 3
    may_create_opportunity: string[]; // exactly 3
    avoid: string[]; // exactly 3
    watchlist: { theme: string; note: string }[]; // exactly 5, themes not tickers
    closing_message: string;
    benchmarks: BenchmarkRowV2[]; // server-fetched, merged in after model call
  };
  sources_used?: string[];
  // Name -> real URL for every successfully-scraped source this run (search-
  // result "sources" have a pseudo `search:...` url and are deliberately
  // excluded here — the UI renders those as plain text, not a dead link).
  // Merged in server-side (stream/route.ts) from the real ScrapedSource[]
  // list; lets every page's footer link back to what actually informed it.
  source_urls?: Record<string, string>;
};

export type OutlookStreamEventV2 =
  | { type: "status"; stage: "scraping" | "market-data" | "drafting"; detail?: string }
  | { type: "source_done"; name: string; ok: boolean }
  // Fund distribution scrapes that failed or came back without a usable
  // number get re-scraped (in parallel with Claude drafting, so it costs no
  // extra wall-clock) — this logs each retry round for the UI.
  | { type: "fund_retry"; keys: FundKey[]; names: string[]; attempt: number; maxAttempts: number }
  | { type: "report"; data: ReportDataV2 }
  | { type: "error"; message: string };
