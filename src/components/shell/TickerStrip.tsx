"use client";
import { useEffect, useState } from "react";

type Quote = {
  sym: string;
  price: number | null;
  changePct: number | null;
  dir: "up" | "down" | "flat";
};

const FALLBACK: Quote[] = [
  { sym: "SPX", price: null, changePct: null, dir: "flat" },
  { sym: "NDX", price: null, changePct: null, dir: "flat" },
  { sym: "BTC", price: null, changePct: null, dir: "flat" },
  { sym: "ETH", price: null, changePct: null, dir: "flat" },
  { sym: "USD/SGD", price: null, changePct: null, dir: "flat" },
  { sym: "VIX", price: null, changePct: null, dir: "flat" },
];

function fmtPrice(sym: string, p: number | null): string {
  if (p == null) return "—";
  if (sym === "USD/SGD") return p.toFixed(4);
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return p.toFixed(2);
}

function fmtPct(p: number | null): string {
  if (p == null) return "";
  const sign = p > 0 ? "▲" : p < 0 ? "▼" : "·";
  return `${sign} ${Math.abs(p).toFixed(2)}%`;
}

export function TickerStrip() {
  const [quotes, setQuotes] = useState<Quote[]>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/ticker", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && Array.isArray(j.quotes)) setQuotes(j.quotes);
      } catch {
        /* keep last */
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="bg-black border-b border-border px-3 py-1 flex gap-7 text-[11px] overflow-x-auto whitespace-nowrap">
      {quotes.map((t) => (
        <div key={t.sym} className="inline-flex gap-1.5 shrink-0">
          <span className="text-text">{t.sym}</span>
          <span
            className={
              t.dir === "up"
                ? "text-green"
                : t.dir === "down"
                ? "text-red"
                : "text-muted"
            }
          >
            {fmtPrice(t.sym, t.price)} {fmtPct(t.changePct)}
          </span>
        </div>
      ))}
    </div>
  );
}
