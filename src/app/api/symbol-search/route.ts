import { NextRequest, NextResponse } from "next/server";

const KEY = process.env.FINNHUB_API_KEY;
const BASE = "https://finnhub.io/api/v1";

type FinnhubSearchResult = {
  description: string;
  displaySymbol: string;
  symbol: string;
  type: string;
};

type FinnhubSearchResponse = {
  count: number;
  result: FinnhubSearchResult[];
};

const TYPE_LABELS: Record<string, string> = {
  "Common Stock": "STOCK",
  "ETP": "ETF",
  "ADR": "ADR",
  "": "",
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const assetClass = req.nextUrl.searchParams.get("type") ?? "stocks";

  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  if (!KEY) {
    return NextResponse.json({ results: [] });
  }

  try {
    const r = await fetch(
      `${BASE}/search?q=${encodeURIComponent(q)}&exchange=US&token=${KEY}`,
      { cache: "no-store" }
    );
    if (!r.ok) return NextResponse.json({ results: [] });

    const data = (await r.json()) as FinnhubSearchResponse;

    const typeFilter =
      assetClass === "etf"
        ? ["ETP"]
        : assetClass === "stocks"
        ? ["Common Stock", "ADR"]
        : null;

    const results = (data.result ?? [])
      .filter((item) => !typeFilter || typeFilter.includes(item.type))
      .slice(0, 8)
      .map((item) => ({
        symbol: item.displaySymbol,
        name: item.description,
        type: TYPE_LABELS[item.type] ?? item.type,
      }));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
