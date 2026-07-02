import "server-only";

const SEC_BASE = "https://data.sec.gov";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_HEADERS = {
  "User-Agent": "gods-eye/1.0 shane.simsq@gmail.com",
  Accept: "application/json",
};

export type EdgarFinancial = {
  year: number;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  operatingCashFlow: number | null;
};

export type EdgarData = {
  cik: string;
  entityName: string;
  financials: EdgarFinancial[];
};

async function fetchJson<T>(url: string, revalidate = 3600): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(url, {
      headers: SEC_HEADERS,
      next: { revalidate },
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) return null;
    return r.json() as Promise<T>;
  } catch {
    return null;
  }
}

async function getCIK(ticker: string): Promise<string | null> {
  type TickerEntry = { cik_str: number; ticker: string; title: string };
  const data = await fetchJson<Record<string, TickerEntry>>(TICKERS_URL, 86400);
  if (!data) return null;
  const upper = ticker.toUpperCase();
  for (const entry of Object.values(data)) {
    if (entry.ticker?.toUpperCase() === upper) {
      return String(entry.cik_str).padStart(10, "0");
    }
  }
  return null;
}

type FactEntry = { end: string; val: number; form: string };
type UsgaapFact = { units: { USD?: FactEntry[]; "USD/shares"?: FactEntry[] } };
type CompanyFacts = {
  entityName: string;
  facts: { "us-gaap"?: Record<string, UsgaapFact> };
};

function extractAnnual(
  gaap: Record<string, UsgaapFact> | undefined,
  candidates: string[],
  unit: "USD" | "USD/shares" = "USD"
): Record<number, number> {
  if (!gaap) return {};
  for (const key of candidates) {
    const entries = gaap[key]?.units[unit];
    if (!entries?.length) continue;
    const byYear: Record<number, number> = {};
    for (const e of entries) {
      if (e.form !== "10-K") continue;
      const year = parseInt(e.end.slice(0, 4), 10);
      byYear[year] = e.val;
    }
    if (Object.keys(byYear).length > 0) return byYear;
  }
  return {};
}

export async function getEdgarData(ticker: string): Promise<EdgarData | null> {
  const cik = await getCIK(ticker);
  if (!cik) return null;

  const facts = await fetchJson<CompanyFacts>(
    `${SEC_BASE}/api/companyfacts/CIK${cik}.json`
  );
  if (!facts) return null;

  const gaap = facts.facts["us-gaap"];

  const revenues = extractAnnual(gaap, [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueGoodsNet",
  ]);
  const netIncomes = extractAnnual(gaap, ["NetIncomeLoss"]);
  const epsData = extractAnnual(gaap, [
    "EarningsPerShareDiluted",
    "EarningsPerShareBasic",
  ], "USD/shares");
  const ocfData = extractAnnual(gaap, [
    "NetCashProvidedByUsedInOperatingActivities",
  ]);

  const allYears = new Set([
    ...Object.keys(revenues),
    ...Object.keys(netIncomes),
    ...Object.keys(epsData),
    ...Object.keys(ocfData),
  ].map(Number));

  if (allYears.size === 0) return null;

  const years = [...allYears].sort((a, b) => b - a).slice(0, 5);

  return {
    cik,
    entityName: facts.entityName,
    financials: years.map((year) => ({
      year,
      revenue: revenues[year] ?? null,
      netIncome: netIncomes[year] ?? null,
      eps: epsData[year] ?? null,
      operatingCashFlow: ocfData[year] ?? null,
    })),
  };
}
