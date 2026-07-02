"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";

const CLASS_SLUGS: Record<string, string> = {
  stocks: "stocks",
  etf: "etf",
  crypto: "crypto",
  options: "options",
};

type SearchResult = { symbol: string; name: string; type: string };

export function TickerSearch({
  assetClass,
  currentTicker,
}: {
  assetClass: string;
  currentTicker?: string;
}) {
  const router = useRouter();
  const [ticker, setTicker] = useState(currentTicker ?? "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const disabled = assetClass === "options";
  const hasAutocomplete = assetClass === "stocks" || assetClass === "etf";

  useEffect(() => {
    const q = ticker.trim();
    if (disabled || !hasAutocomplete || q.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/symbol-search?q=${encodeURIComponent(q)}&type=${assetClass}`
        );
        const data = (await res.json()) as { results: SearchResult[] };
        setResults(data.results ?? []);
        setOpen((data.results ?? []).length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [ticker, assetClass, disabled]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function navigate(sym: string) {
    setOpen(false);
    setTicker(sym);
    const slug = CLASS_SLUGS[assetClass] ?? assetClass;
    router.push(`/guru/${slug}/${sym}`);
  }

  return (
    <div ref={wrapRef} className="relative flex items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled) return;
          const t = ticker.trim().toUpperCase();
          if (!t) return;
          navigate(t);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={disabled ? "N/A" : "TICKER"}
          disabled={disabled}
          autoComplete="off"
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

      {open && results.length > 0 && (
        <div className="absolute top-full right-0 mt-1 z-50 w-72 border border-amber/40 bg-[#0a0a0a] shadow-xl">
          {loading && (
            <div className="text-[10px] text-dim px-3 py-1.5 uppercase tracking-wider">
              Searching…
            </div>
          )}
          {results.map((r) => (
            <button
              key={r.symbol}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                navigate(r.symbol);
              }}
              className="w-full text-left px-3 py-2 hover:bg-amber/10 border-b border-border/40 last:border-0 group"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-bold text-amber group-hover:text-amber tabular-nums">
                  {r.symbol}
                </span>
                {r.type && (
                  <span className="text-[9px] text-dim border border-border px-1 py-0.5 uppercase tracking-wider">
                    {r.type}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted mt-0.5 truncate">{r.name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
