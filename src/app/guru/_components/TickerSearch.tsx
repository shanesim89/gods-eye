"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const CLASS_SLUGS: Record<string, string> = {
  stocks: "stocks",
  etf: "etf",
  crypto: "crypto",
  options: "options",
};

export function TickerSearch({
  assetClass,
  currentTicker,
}: {
  assetClass: string;
  currentTicker?: string;
}) {
  const router = useRouter();
  const [ticker, setTicker] = useState(currentTicker ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = ticker.trim().toUpperCase();
        if (!t) return;
        const slug = CLASS_SLUGS[assetClass] ?? assetClass;
        router.push(`/guru/${slug}/${t}`);
      }}
      className="flex items-center gap-2"
    >
      <input
        value={ticker}
        onChange={(e) => setTicker(e.target.value.toUpperCase())}
        placeholder="TICKER"
        className="bg-grid border border-border px-2 py-1 text-[11px] text-text uppercase w-28 focus:border-amber outline-none"
      />
      <button
        type="submit"
        className="bg-amber text-black px-3 py-1 text-[11px] font-bold tracking-wider hover:bg-amber/80 transition-colors"
      >
        ▸ GO
      </button>
    </form>
  );
}
