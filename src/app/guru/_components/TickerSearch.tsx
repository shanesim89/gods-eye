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
  const disabled = assetClass === "options";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
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
        placeholder={disabled ? "COMING SOON" : "TICKER"}
        disabled={disabled}
        className="bg-grid border border-border px-2 py-1 text-[11px] text-text uppercase w-28 focus:border-amber outline-none disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        disabled={disabled}
        className="bg-amber text-black px-3 py-1 text-[11px] font-bold tracking-wider hover:bg-amber/80 transition-colors disabled:bg-muted disabled:cursor-not-allowed"
      >
        {disabled ? "—" : "▸ GO"}
      </button>
    </form>
  );
}
