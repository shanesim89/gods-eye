import { NextResponse } from "next/server";

export const revalidate = 15; // cache 15s on edge

const SYMBOLS: { label: string; yf: string }[] = [
  { label: "SPX", yf: "^GSPC" },
  { label: "NDX", yf: "^NDX" },
  { label: "BTC", yf: "BTC-USD" },
  { label: "ETH", yf: "ETH-USD" },
  { label: "USD/SGD", yf: "SGD=X" },
  { label: "VIX", yf: "^VIX" },
];

type Quote = {
  sym: string;
  price: number | null;
  changePct: number | null;
  dir: "up" | "down" | "flat";
};

async function fetchOne(yf: string, label: string): Promise<Quote> {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        yf
      )}?interval=1d&range=2d`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; gods-eye-dashboard/0.1; +https://github.com/shanesim89/gods-eye)",
        },
        next: { revalidate: 15 },
      }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? null;
    const prev = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
    const changePct =
      price != null && prev != null && prev !== 0
        ? ((price - prev) / prev) * 100
        : null;
    const dir: Quote["dir"] =
      changePct == null ? "flat" : changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
    return { sym: label, price, changePct, dir };
  } catch {
    return { sym: label, price: null, changePct: null, dir: "flat" };
  }
}

export async function GET() {
  const quotes = await Promise.all(SYMBOLS.map((s) => fetchOne(s.yf, s.label)));
  return NextResponse.json({ quotes, fetchedAt: new Date().toISOString() });
}
