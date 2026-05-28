import "server-only";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const CG_KEY = process.env.COINGECKO_API_KEY;
const FH_BASE = "https://finnhub.io/api/v1";
const CG_BASE = "https://api.coingecko.com/api/v3";
const REVALIDATE = 600; // 10min ISR cache

export type SpxTile = {
  ticker: string;
  name: string;
  sector: string;
  pct: number;
  price: number;
};

export type CryptoTile = {
  id: string;
  symbol: string;
  name: string;
  pct: number;
  price: number;
  mktCap: number;
};

export type FearGreedData = {
  crypto: { value: number; label: string; updated: string } | null;
  stocks: { value: number; label: string; source: string } | null;
};

// Top 50 S&P500 by market cap, grouped by sector
export const SPX_TOP50: { ticker: string; name: string; sector: string }[] = [
  // Technology
  { ticker: "AAPL",  name: "Apple",          sector: "Technology" },
  { ticker: "MSFT",  name: "Microsoft",       sector: "Technology" },
  { ticker: "NVDA",  name: "NVIDIA",          sector: "Technology" },
  { ticker: "AVGO",  name: "Broadcom",        sector: "Technology" },
  { ticker: "CRM",   name: "Salesforce",      sector: "Technology" },
  { ticker: "ORCL",  name: "Oracle",          sector: "Technology" },
  { ticker: "AMD",   name: "AMD",             sector: "Technology" },
  { ticker: "ADBE",  name: "Adobe",           sector: "Technology" },
  { ticker: "ACN",   name: "Accenture",       sector: "Technology" },
  { ticker: "CSCO",  name: "Cisco",           sector: "Technology" },
  { ticker: "TXN",   name: "Texas Instr.",    sector: "Technology" },
  { ticker: "QCOM",  name: "Qualcomm",        sector: "Technology" },
  { ticker: "INTC",  name: "Intel",           sector: "Technology" },
  // Communication Services
  { ticker: "GOOGL", name: "Alphabet",        sector: "Comm. Svcs" },
  { ticker: "META",  name: "Meta",            sector: "Comm. Svcs" },
  { ticker: "NFLX",  name: "Netflix",         sector: "Comm. Svcs" },
  { ticker: "DIS",   name: "Disney",          sector: "Comm. Svcs" },
  // Consumer Discretionary
  { ticker: "AMZN",  name: "Amazon",          sector: "Cons. Disc" },
  { ticker: "TSLA",  name: "Tesla",           sector: "Cons. Disc" },
  { ticker: "HD",    name: "Home Depot",      sector: "Cons. Disc" },
  { ticker: "MCD",   name: "McDonald's",      sector: "Cons. Disc" },
  { ticker: "LOW",   name: "Lowe's",          sector: "Cons. Disc" },
  { ticker: "COST",  name: "Costco",          sector: "Cons. Disc" },
  // Healthcare
  { ticker: "LLY",   name: "Eli Lilly",       sector: "Healthcare" },
  { ticker: "UNH",   name: "UnitedHealth",    sector: "Healthcare" },
  { ticker: "JNJ",   name: "J&J",             sector: "Healthcare" },
  { ticker: "ABBV",  name: "AbbVie",          sector: "Healthcare" },
  { ticker: "MRK",   name: "Merck",           sector: "Healthcare" },
  { ticker: "ABT",   name: "Abbott",          sector: "Healthcare" },
  { ticker: "TMO",   name: "Thermo Fisher",   sector: "Healthcare" },
  { ticker: "AMGN",  name: "Amgen",           sector: "Healthcare" },
  // Financials
  { ticker: "JPM",   name: "JPMorgan",        sector: "Financials" },
  { ticker: "V",     name: "Visa",            sector: "Financials" },
  { ticker: "MA",    name: "Mastercard",      sector: "Financials" },
  { ticker: "BAC",   name: "Bank of Amer.",   sector: "Financials" },
  { ticker: "WFC",   name: "Wells Fargo",     sector: "Financials" },
  { ticker: "GS",    name: "Goldman Sachs",   sector: "Financials" },
  // Consumer Staples
  { ticker: "WMT",   name: "Walmart",         sector: "Staples" },
  { ticker: "PG",    name: "P&G",             sector: "Staples" },
  { ticker: "KO",    name: "Coca-Cola",       sector: "Staples" },
  { ticker: "PEP",   name: "PepsiCo",         sector: "Staples" },
  { ticker: "PM",    name: "Philip Morris",   sector: "Staples" },
  // Energy
  { ticker: "XOM",   name: "ExxonMobil",      sector: "Energy" },
  { ticker: "CVX",   name: "Chevron",         sector: "Energy" },
  { ticker: "COP",   name: "ConocoPhillips",  sector: "Energy" },
  // Industrials
  { ticker: "CAT",   name: "Caterpillar",     sector: "Industrials" },
  { ticker: "GE",    name: "GE Aerospace",    sector: "Industrials" },
  { ticker: "RTX",   name: "RTX Corp",        sector: "Industrials" },
  { ticker: "HON",   name: "Honeywell",       sector: "Industrials" },
  // Materials + Utilities
  { ticker: "LIN",   name: "Linde",           sector: "Materials" },
  { ticker: "NEE",   name: "NextEra Energy",  sector: "Utilities" },
];

async function fhFetch<T>(path: string): Promise<T | null> {
  if (!FINNHUB_KEY) return null;
  try {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${FH_BASE}${path}${sep}token=${FINNHUB_KEY}`, {
      next: { revalidate: REVALIDATE },
    });
    if (!r.ok) return null;
    return r.json() as Promise<T>;
  } catch {
    return null;
  }
}

type FhQuote = { c: number; dp: number };

export async function getSpxHeatmap(): Promise<SpxTile[]> {
  const results = await Promise.allSettled(
    SPX_TOP50.map((s) => fhFetch<FhQuote>(`/quote?symbol=${encodeURIComponent(s.ticker)}`))
  );
  return SPX_TOP50.map((s, i) => {
    const q = results[i].status === "fulfilled" ? results[i].value : null;
    return {
      ticker: s.ticker,
      name: s.name,
      sector: s.sector,
      pct: q?.dp ?? 0,
      price: q?.c ?? 0,
    };
  });
}

type CgMarketItem = {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
};

export async function getCryptoHeatmap(): Promise<CryptoTile[]> {
  const headers: Record<string, string> = CG_KEY ? { "x-cg-demo-api-key": CG_KEY } : {};
  try {
    const r = await fetch(
      `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&price_change_percentage=24h`,
      { headers, next: { revalidate: REVALIDATE } }
    );
    if (!r.ok) return [];
    const data = (await r.json()) as CgMarketItem[];
    return data.map((c) => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      pct: c.price_change_percentage_24h ?? 0,
      price: c.current_price,
      mktCap: c.market_cap,
    }));
  } catch {
    return [];
  }
}

export async function getFearGreed(): Promise<FearGreedData> {
  // Crypto: alternative.me (free, no key, daily)
  let crypto: FearGreedData["crypto"] = null;
  try {
    const r = await fetch("https://api.alternative.me/fng/?limit=1", {
      next: { revalidate: 3600 },
    });
    if (r.ok) {
      const j = (await r.json()) as {
        data: { value: string; value_classification: string; timestamp: string }[];
      };
      const d = j.data?.[0];
      if (d)
        crypto = {
          value: Number(d.value),
          label: d.value_classification,
          updated: d.timestamp,
        };
    }
  } catch { /* ignore */ }

  // Stocks: VIXY (short-term VIX futures ETF) as volatility proxy
  // VIXY ~10-15 → calm/greed | 15-22 → neutral | 22-30 → fear | 30+ → extreme fear
  let stocks: FearGreedData["stocks"] = null;
  try {
    const q = await fhFetch<FhQuote>("/quote?symbol=VIXY");
    if (q?.c && q.c > 0) {
      const v = q.c;
      let value: number;
      let label: string;
      if (v < 12)      { value = 88; label = "Extreme Greed"; }
      else if (v < 16) { value = 68; label = "Greed"; }
      else if (v < 21) { value = 50; label = "Neutral"; }
      else if (v < 28) { value = 30; label = "Fear"; }
      else             { value = 12; label = "Extreme Fear"; }
      stocks = { value, label, source: `VIXY $${v.toFixed(2)}` };
    }
  } catch { /* ignore */ }

  return { crypto, stocks };
}
