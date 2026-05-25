import { NextResponse } from "next/server";

export const revalidate = 15;

const KEY = process.env.FINNHUB_API_KEY;

// Finnhub symbols: stocks/ETFs use plain symbol, indices use ^ prefix, FX use OANDA: prefix, crypto via BINANCE:
const SYMBOLS: { label: string; finnhub: string; crypto?: boolean }[] = [
  { label: "SPX", finnhub: "^GSPC" },
  { label: "NDX", finnhub: "^NDX" },
  { label: "BTC", finnhub: "BINANCE:BTCUSDT", crypto: true },
  { label: "ETH", finnhub: "BINANCE:ETHUSDT", crypto: true },
  { label: "USD/SGD", finnhub: "OANDA:USD_SGD" },
  { label: "VIX", finnhub: "^VIX" },
];

type Quote = {
  sym: string;
  price: number | null;
  changePct: number | null;
  dir: "up" | "down" | "flat";
};

async function finnhubQuote(symbol: string): Promise<{ c: number; pc: number } | null> {
  if (!KEY) return null;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${KEY}`;
  try {
    const r = await fetch(url, { next: { revalidate: 15 } });
    if (!r.ok) return null;
    const j = await r.json();
    if (typeof j?.c !== "number" || j.c === 0) return null;
    return { c: j.c, pc: j.pc };
  } catch {
    return null;
  }
}

async function yahooFallback(yf: string): Promise<{ price: number; prev: number } | null> {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yf)}?interval=1d&range=2d`,
      {
        headers: { "User-Agent": "Mozilla/5.0 gods-eye/0.1" },
        next: { revalidate: 15 },
      }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const prev = meta?.chartPreviousClose ?? meta?.previousClose;
    if (typeof price !== "number" || typeof prev !== "number") return null;
    return { price, prev };
  } catch {
    return null;
  }
}

const YAHOO_FALLBACK_MAP: Record<string, string> = {
  SPX: "^GSPC",
  NDX: "^NDX",
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  "USD/SGD": "SGD=X",
  VIX: "^VIX",
};

async function fetchOne(label: string, finnhub: string): Promise<Quote> {
  // try Finnhub first
  const fh = await finnhubQuote(finnhub);
  if (fh) {
    const changePct = fh.pc !== 0 ? ((fh.c - fh.pc) / fh.pc) * 100 : 0;
    return {
      sym: label,
      price: fh.c,
      changePct,
      dir: changePct > 0 ? "up" : changePct < 0 ? "down" : "flat",
    };
  }
  // fallback to Yahoo (Finnhub free tier doesn't include some indices/FX)
  const yf = YAHOO_FALLBACK_MAP[label];
  if (yf) {
    const y = await yahooFallback(yf);
    if (y) {
      const changePct = y.prev !== 0 ? ((y.price - y.prev) / y.prev) * 100 : 0;
      return {
        sym: label,
        price: y.price,
        changePct,
        dir: changePct > 0 ? "up" : changePct < 0 ? "down" : "flat",
      };
    }
  }
  return { sym: label, price: null, changePct: null, dir: "flat" };
}

export async function GET() {
  const quotes = await Promise.all(SYMBOLS.map((s) => fetchOne(s.label, s.finnhub)));
  return NextResponse.json({
    quotes,
    source: KEY ? "finnhub+yahoo" : "yahoo",
    fetchedAt: new Date().toISOString(),
  });
}
