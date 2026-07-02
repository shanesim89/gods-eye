"use client";
import Link from "next/link";
import { useState } from "react";

type ScreenRow = {
  symbol: string;
  name: string;
  price: number;
  assetClass: "crypto" | "stocks";
  href: string;
  score: number;
  metrics: Record<string, number | string | boolean | null>;
};

type ScreenResult = {
  theme: string;
  assetClass: "crypto" | "stocks";
  generatedAt: string;
  total: number;
  matched: number;
  rationale: string;
  unmet: string[];
  rows: ScreenRow[];
};

const EXAMPLES: Record<"crypto" | "stocks", string[]> = {
  crypto: [
    "Stealth accumulation under $500M cap, turning up",
    "High-momentum breakouts with social surge",
    "Deep below ATH with big upside runway",
  ],
  stocks: [
    "Stage-2 uptrend leaders with accelerating revenue",
    "Early-stage momentum, not yet extended",
    "Stretched dips near support with high bounce odds",
  ],
};

function fmtMetric(key: string, v: number | string | boolean | null): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  if (key === "mcap") {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v.toFixed(0)}`;
  }
  const abs = Math.abs(v);
  return abs >= 100 ? v.toFixed(0) : abs >= 1 ? v.toFixed(1) : v.toFixed(2);
}

const SHORT_LABEL: Record<string, string> = {
  "dims.momentum": "mom", "dims.runway": "runway", "dims.stealth": "stealth",
  "dims.liquidity": "liq", pct24h: "24h%", pct7d: "7d%", pct30d: "30d%",
  athChangePct: "fromATH", upsideMultiple: "upsideX", volMcap: "vol/mc",
  mom_12_1: "mom12-1", near_high_pct: "fromHigh", rs_spy: "RS", ma_stack: "stage2",
  revenue_growth: "revG%", earnings_growth: "epsG%", profit_margin: "margin%",
  leader_score: "leader", momentum_score: "momSc", growth_score: "growSc",
  bounce_score: "bounce", bounce_probability: "bProb", dip_signal_pct: "vs20MA",
  drop_pct: "drop%", near_support: "support",
};

export function ScreenWorkspace() {
  const [assetClass, setAssetClass] = useState<"crypto" | "stocks">("crypto");
  const [theme, setTheme] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScreenResult | null>(null);

  async function run(t?: string) {
    const q = (t ?? theme).trim();
    if (q.length < 3) return;
    setTheme(q);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/guru/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: q, assetClass }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "screen failed");
        setResult(null);
      } else {
        setResult(data as ScreenResult);
      }
    } catch {
      setError("network error");
    } finally {
      setLoading(false);
    }
  }

  const metricKeys = result?.rows[0] ? Object.keys(result.rows[0].metrics) : [];

  return (
    <div className="flex flex-col gap-3">
      {/* asset toggle */}
      <div className="flex items-center gap-2">
        {(["crypto", "stocks"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setAssetClass(c)}
            className={`px-3 py-1 text-[11px] uppercase tracking-[1px] border transition-colors ${
              assetClass === c
                ? "border-cyan text-cyan hud-text-glow"
                : "border-border text-dim hover:text-muted"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* theme input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="flex items-stretch gap-2"
      >
        <input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          placeholder="Describe a theme — e.g. stealth accumulation under $500M cap"
          className="flex-1 bg-grid border border-border px-2.5 py-2 text-[11px] text-text focus:border-cyan outline-none"
        />
        <button
          type="submit"
          disabled={loading || theme.trim().length < 3}
          className="bg-cyan text-black px-4 py-2 text-[11px] font-bold tracking-wider hover:bg-cyan/80 transition-colors disabled:bg-muted disabled:cursor-not-allowed"
        >
          {loading ? "SCANNING…" : "▸ SCAN"}
        </button>
      </form>

      {/* example chips */}
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES[assetClass].map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => run(ex)}
            className="text-[10px] text-dim border border-border/60 px-2 py-1 hover:border-cyan hover:text-cyan transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div className="border border-red/40 bg-red/5 text-red text-[10px] px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-2">
          {/* summary */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-1.5">
            <div className="text-[10px] text-muted">
              {result.rationale || `Screen for "${result.theme}"`}
            </div>
            <div className="text-[10px] text-dim tabular-nums">
              {result.matched} match / {result.total} universe
            </div>
          </div>

          {/* unmet criteria — honest data gaps */}
          {result.unmet.length > 0 && (
            <div className="border border-amber/40 bg-amber/5 px-3 py-2">
              <div className="text-amber text-[10px] uppercase tracking-[1px] mb-1">
                ⚠ Not screened — no data source
              </div>
              <ul className="text-[10px] text-muted list-disc pl-4 space-y-0.5">
                {result.unmet.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          )}

          {/* results table */}
          {result.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-dim text-[10px] uppercase tracking-[1px] border-b border-border">
                    <td className="py-1 pr-2">#</td>
                    <td className="py-1 pr-2">Symbol</td>
                    <td className="py-1 pr-3 text-right">Score</td>
                    {metricKeys.map((k) => (
                      <td key={k} className="py-1 pr-3 text-right whitespace-nowrap">
                        {SHORT_LABEL[k] ?? k}
                      </td>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={r.symbol} className="dotted-row hover:bg-grid">
                      <td className="py-1 pr-2 text-dim tabular-nums">{i + 1}</td>
                      <td className="py-1 pr-2">
                        <Link href={r.href} className="text-cyan font-bold hover:underline">
                          {r.symbol}
                        </Link>
                        <span className="text-dim ml-1.5 truncate">{r.name}</span>
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums text-cyan font-bold">
                        {r.score.toFixed(1)}
                      </td>
                      {metricKeys.map((k) => (
                        <td key={k} className="py-1 pr-3 text-right tabular-nums text-muted whitespace-nowrap">
                          {fmtMetric(k, r.metrics[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-dim text-[10px] italic py-2">
              No matches. Loosen the theme or try a different angle.
            </div>
          )}

          <div className="text-dim text-[10px] italic mt-1">
            Ranking is a normalized weighted score across the theme's signals — indicative, not a strategy backtest.
          </div>
        </div>
      )}
    </div>
  );
}
