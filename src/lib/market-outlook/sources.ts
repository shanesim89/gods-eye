// Source registry + query builder for the Market Outlook pipeline. Pure — no I/O.
// Total Firecrawl calls per report is capped at 7 (3 fixed scrapes + ≤4 searches)
// to keep the scrape phase inside its 18s deadline and credits ~13/report.

import type { FundKey, ReportFilters } from "./types";

// Fixed outlook-commentary pages — the "inspiration" sources. Edit freely.
export const FIXED_SCRAPES: { name: string; url: string }[] = [
  {
    name: "BlackRock Weekly Commentary",
    url: "https://www.blackrock.com/us/individual/insights/blackrock-investment-institute/weekly-commentary",
  },
  {
    name: "Schwab Market Commentary",
    url: "https://www.schwab.com/learn/story/weekly-traders-outlook",
  },
  {
    name: "JPMorgan Weekly Recap",
    url: "https://www.jpmorgan.com/insights/global-research/markets/market-updates",
  },
];

// Page-4 income-fund sources — scraped separately from the commentary sources
// above since they feed structured fund figures (allocation, distribution
// rate), not narrative. The UI's VERIFIED/UNVERIFIED badge reflects whether
// parseFundDistributions (market-data.ts) actually matched a real number in
// the scrape — it is not a blanket flag either way.
//
// These are FSMOne/Great Eastern fund-house dealer pages, not the fund
// managers' own marketing pages — the dealer pages render their "Dividend
// Yield (%)" / distribution figures via client-side JS, so they need a real
// waitForMs (confirmed empirically: <6s render incomplete, ~8s reliable) or
// the scrape captures only page chrome with no numbers.
export const FUND_SCRAPES: { key: FundKey; name: string; url: string; waitForMs?: number }[] = [
  {
    key: "pimco",
    name: "PIMCO Income Fund Cl E Inc SGD-H (FSMOne)",
    url: "https://secure.fundsupermart.com/fsmone/funds/factsheet/ALZP06/PIMCO-Income-Fund-Cl-E-Inc-SGD-H",
    waitForMs: 8000,
  },
  {
    key: "allianz",
    name: "Allianz Income and Growth Cl AMi3 DIS H2 SGD (FSMOne)",
    url: "https://secure.fundsupermart.com/fsmone/funds/factsheet/ALZ210/Allianz-Income-and-Growth-Cl-AMi3-DIS-H2-SGD",
    waitForMs: 8000,
  },
  {
    key: "fssa",
    name: "FSSA Dividend Advantage A QDIS SGD (FSMOne)",
    url: "https://secure.fundsupermart.com/fsmone/funds/factsheet/FSDVAD/FSSA-Dividend-Advantage-A-QDIS-SGD",
    waitForMs: 8000,
  },
  {
    key: "greatlink",
    name: "GreatLink Global Real Estate Securities Fund (Great Eastern)",
    url: "https://www.greateasternlife.com/sg/en/personal-insurance/our-products/wealth-accumulation/investment-linked-funds/ilp-fund-centre.html#/detail?id=F0HKG070AN_F26",
    waitForMs: 6000,
  },
];

export function buildSearchQueries(
  filters: ReportFilters
): { name: string; query: string }[] {
  const now = new Date();
  const label = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  const span = filters.period === "quarterly" ? "this quarter" : "this week";

  const regionText = filters.regions.length
    ? filters.regions.join(" ")
    : "global";

  const queries: { name: string; query: string }[] = [
    {
      name: "Market news",
      query: `${regionText} stock market news ${span} Reuters CNBC`,
    },
    {
      name: "Economic calendar",
      query: `major economic calendar events next two weeks Fed CPI central bank ${label}`,
    },
  ];

  if (filters.sectors.length > 0) {
    queries.push({
      name: "Sector outlook",
      query: `${filters.sectors.join(" ")} sector outlook investors ${label}`,
    });
  }

  if (filters.regions.includes("Singapore") || filters.regions.includes("Global")) {
    queries.push({
      name: "Singapore market",
      query: `Singapore market news Business Times MAS Straits Times ${label}`,
    });
  }

  return queries;
}
