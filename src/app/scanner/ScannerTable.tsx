"use client";
import { useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ScanResult, ScoredCoin, Bucket, RiskTier, TrendSnapshot } from "@/lib/crypto/scanner";

type Mode = "moonshot" | "scalp";
type SortKey =
  | "score"
  | "pct1h"
  | "pct24h"
  | "pct7d"
  | "mcap"
  | "volMcap"
  | "athChangePct"
  | "upsideMultiple";

const BUCKET_FILTERS: { key: Bucket | "ALL"; label: string }[] = [
  { key: "ALL", label: "ALL" },
  { key: "MOONSHOT", label: "MOONSHOT" },
  { key: "BREAKOUT", label: "BREAKOUT" },
  { key: "STEALTH", label: "STEALTH" },
  { key: "SOCIAL", label: "SOCIAL" },
];

const TIER_FILTERS: { key: RiskTier | "ALL"; label: string }[] = [
  { key: "ALL", label: "ALL TIERS" },
  { key: "low", label: "LOW" },
  { key: "medium", label: "MED" },
  { key: "high", label: "HIGH" },
  { key: "speculative", label: "SPEC" },
];

function fmtPrice(p: number): string {
  if (p >= 1000) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.0001) return `$${p.toPrecision(3)}`;
  return `$${p.toExponential(2)}`;
}

function fmtCap(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${(n / 1e3).toFixed(0)}k`;
}

function Pct({ v }: { v: number | null }) {
  if (v === null || !Number.isFinite(v)) return <span className="text-dim">—</span>;
  const cls = v > 0 ? "text-green" : v < 0 ? "text-red" : "text-muted";
  return (
    <span className={cls}>
      {v > 0 ? "+" : ""}
      {v.toFixed(1)}%
    </span>
  );
}

const TIER_COLOR: Record<RiskTier, string> = {
  low: "text-green",
  medium: "text-cyan",
  high: "text-amber",
  speculative: "text-red",
};

const BUCKET_COLOR: Record<Bucket, string> = {
  MOONSHOT: "text-amber border-amber/40",
  BREAKOUT: "text-green border-green/40",
  STEALTH: "text-cyan border-cyan/40",
  SOCIAL: "text-fuchsia-400 border-fuchsia-400/40",
};

const REASONING: { term: string; color: string; what: string; why: string }[] = [
  {
    term: "◆ MOONSHOT TAB",
    color: "text-amber",
    what: "Swing ranking (days–weeks hold). Weights: upside runway 35% · stealth accumulation 30% · momentum 20% · liquidity 15%.",
    why: "50× moves take weeks to play out. Coins deeply down from a proven ATH that just started turning, plus quiet accumulation, give the biggest multiple math.",
  },
  {
    term: "⚡ SCALP TAB",
    color: "text-amber",
    what: "Short-term ranking (hours–days hold). Weights: momentum ignition 50% · liquidity 20% · runway 15% · stealth 15%.",
    why: "For quick entries the only thing that matters is what is igniting right now — abnormal volume plus 24h price acceleration that outpaces the 7d trend.",
  },
  {
    term: "MOONSHOT tag",
    color: "text-amber",
    what: "Coin is down 80–97% from its all-time high AND has started turning up (7d > 0 or 24h > +5%).",
    why: "Down 95% = 20× just to reclaim a level the market already paid once. The turn filter removes dead coins that never recover.",
  },
  {
    term: "BREAKOUT tag",
    color: "text-green",
    what: "Volume/mcap in the healthy 0.1–1.0 band AND 24h price pace faster than the 7d average pace, 1h confirming direction.",
    why: "Volume precedes price. Acceleration catches the inflection point of a move instead of chasing an exhausted pump.",
  },
  {
    term: "STEALTH tag",
    color: "text-cyan",
    what: "Rank 300–1000 coin with rising volume but price still flat (|7d| < 10%) and a tight 7d range.",
    why: "Classic Wyckoff accumulation — someone is buying quietly without moving price. Earliest possible signal, before momentum is visible.",
  },
  {
    term: "SOCIAL tag",
    color: "text-fuchsia-400",
    what: "LunarCrush galaxy score ≥ 70 (▲ next to score = social surge bonus applied).",
    why: "Retail pumps are front-run by social volume spikes. Crowd attention arriving before price is an early fuel signal.",
  },
  {
    term: "UPSIDE×",
    color: "text-cyan",
    what: "ATH price ÷ current price, capped at 100×.",
    why: "Pure arithmetic of the opportunity: how many times the coin multiplies if it only returns to its previous high.",
  },
  {
    term: "VOL/MC",
    color: "text-muted",
    what: "24h volume ÷ market cap. Healthy: 0.1–1.0. Above 3 = WASH? flag, above 5 = excluded.",
    why: "Normalizes volume across cap sizes — $50M volume is noise on BTC but explosive on a $20M coin. Too high = fake/wash volume.",
  },
  {
    term: "[LOW/MEDI/HIGH/SPEC]",
    color: "text-red",
    what: "Risk tier by mcap: LOW > $1B · MEDIUM > $100M · HIGH > $10M · SPECULATIVE < $10M.",
    why: "Smaller cap = bigger possible multiple AND bigger rug/manipulation risk. SPEC coins can go to zero.",
  },
  {
    term: "FLAGS",
    color: "text-red",
    what: "WASH? = suspect fake volume (vol/mc > 3) · MICRO = mcap < $10M · WILD = |24h| > 40% · THIN = volume < $1M.",
    why: "Each flag is a reason the score might be lying. Treat flagged coins as guilty until your own DD proves otherwise.",
  },
  {
    term: "LATE-PUMP PENALTY",
    color: "text-muted",
    what: "Coins already up > 50% in 7d get their score discounted (down to ×0.6 at +150%).",
    why: "Strong trends can continue, but probability favors earlier entries — penalized, not hidden, so continuation plays stay visible.",
  },
];

function TopPick({ coin, mode }: { coin: ScoredCoin; mode: Mode }) {
  const s = mode === "moonshot" ? coin.scoreMoonshot : coin.scoreScalp;
  const reasons: string[] = [];
  if (coin.dims.runway >= 0.6)
    reasons.push(
      `down ${Math.abs(coin.athChangePct).toFixed(0)}% from ATH and turning up — ${coin.upsideMultiple.toFixed(1)}× back to its proven high`
    );
  if (coin.dims.momentum >= 0.6)
    reasons.push(
      `volume igniting (${coin.volMcap.toFixed(2)}× mcap traded in 24h) with price accelerating (${coin.pct24h !== null && coin.pct24h >= 0 ? "+" : ""}${coin.pct24h?.toFixed(1) ?? "—"}% 24h)`
    );
  if (coin.dims.stealth >= 0.6)
    reasons.push("quiet accumulation pattern — volume building while price still flat");
  if (coin.socialSurge) reasons.push("social attention surging (LunarCrush galaxy ≥ 70)");
  return (
    <div className="border border-green/40 bg-green/5 p-3 mb-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] tracking-[1.5px] text-green font-bold">
          ★ TOP PICK ({mode === "moonshot" ? "SWING" : "SCALP"}) —{" "}
          <span className="text-white">{coin.symbol}</span>{" "}
          <span className="text-dim font-normal">{coin.name}</span>
        </div>
        <div className="text-[10px]">
          <span className="text-muted">SCORE </span>
          <span className="text-amber font-bold">{s}</span>
          <span className="text-muted ml-2">UPSIDE </span>
          <span className="text-cyan">{coin.upsideMultiple.toFixed(1)}×</span>
          <span className={`ml-2 ${TIER_COLOR[coin.riskTier]}`}>
            {coin.riskTier.toUpperCase()}
          </span>
        </div>
      </div>
      <div className="text-[10px] text-muted mt-1 leading-relaxed">
        Why: {reasons.length > 0 ? reasons.join("; ") : "highest composite score in this mode"}.
        {coin.rugFlags.length > 0 && (
          <span className="text-red"> Flags: {coin.rugFlags.join(", ")}.</span>
        )}{" "}
        <span className="text-dim">
          Highest-ranked by this mode&apos;s model — not financial advice. Run the council deep-dive
          before entering.
        </span>
      </div>
    </div>
  );
}

function ScoreDelta({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  if (delta === 0) return <span className="text-dim ml-0.5 text-[8px]">–</span>;
  return (
    <span className={`ml-0.5 text-[8px] ${delta > 0 ? "text-green" : "text-red"}`}>
      {delta > 0 ? `+${delta}↑` : `${delta}↓`}
    </span>
  );
}

export function ScannerTable({
  initial,
  trends = {},
  watchlistIds = [],
}: {
  initial: ScanResult;
  trends?: TrendSnapshot;
  watchlistIds?: string[];
}) {
  const router = useRouter();
  const [data, setData] = useState<ScanResult>(initial);
  const [mode, setMode] = useState<Mode>("moonshot");
  const [bucket, setBucket] = useState<Bucket | "ALL">("ALL");
  const [tier, setTier] = useState<RiskTier | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDesc, setSortDesc] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(watchlistIds));

  const score = (c: ScoredCoin) => (mode === "moonshot" ? c.scoreMoonshot : c.scoreScalp);

  const rows = useMemo(() => {
    let list = data.coins;
    if (bucket !== "ALL") list = list.filter((c) => c.buckets.includes(bucket));
    if (tier !== "ALL") list = list.filter((c) => c.riskTier === tier);
    const val = (c: ScoredCoin): number => {
      if (sortKey === "score") return score(c);
      const v = c[sortKey];
      return typeof v === "number" ? v : -Infinity;
    };
    return [...list].sort((a, b) => (sortDesc ? val(b) - val(a) : val(a) - val(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode, bucket, tier, sortKey, sortDesc]);

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await fetch("/api/crypto/scanner?refresh=1");
      if (r.ok) {
        const fresh = (await r.json()) as ScanResult;
        if (Array.isArray(fresh.coins)) setData(fresh);
      }
    } finally {
      setRefreshing(false);
    }
  }

  function setSort(k: SortKey) {
    if (k === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  }

  const togglePin = useCallback(async (c: ScoredCoin, e: React.MouseEvent) => {
    e.stopPropagation();
    const isPinned = pinned.has(c.id);
    setPinned((prev) => {
      const next = new Set(prev);
      isPinned ? next.delete(c.id) : next.add(c.id);
      return next;
    });
    try {
      if (isPinned) {
        await fetch(`/api/scanner/watchlist?coin_id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
      } else {
        await fetch("/api/scanner/watchlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ coin_id: c.id, symbol: c.symbol, name: c.name }),
        });
      }
    } catch {
      // revert optimistic update on failure
      setPinned((prev) => {
        const next = new Set(prev);
        isPinned ? next.add(c.id) : next.delete(c.id);
        return next;
      });
    }
  }, [pinned]);

  const Th = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: string }) => (
    <th
      className={`px-1.5 py-1 text-${align} text-muted cursor-pointer hover:text-amber select-none whitespace-nowrap`}
      onClick={() => setSort(k)}
    >
      {label}
      {sortKey === k ? (sortDesc ? " ▾" : " ▴") : ""}
    </th>
  );

  const ageMin = Math.round((Date.now() - new Date(data.generatedAt).getTime()) / 60000);

  // Best buy candidate: highest score in current mode without wash/wild flags
  const topPick = useMemo(() => {
    const byScore = [...data.coins].sort((a, b) => score(b) - score(a));
    return (
      byScore.find((c) => !c.rugFlags.includes("WASH?") && !c.rugFlags.includes("WILD")) ??
      byScore[0] ??
      null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode]);

  return (
    <div>
      {/* Mode tabs + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex gap-1">
          {(["moonshot", "scalp"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-[10px] tracking-[1.5px] border ${
                mode === m
                  ? "border-amber text-amber bg-amber/10"
                  : "border-border text-muted hover:text-amber"
              }`}
            >
              {m === "moonshot" ? "◆ MOONSHOT (SWING)" : "⚡ SCALP (SHORT-TERM)"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-dim">
            scanned {data.universe} · passed {data.passed} · {ageMin < 1 ? "now" : `${ageMin}m ago`}
          </span>
          <button
            onClick={() => setShowReasoning((s) => !s)}
            className={`px-2 py-1 border ${
              showReasoning
                ? "border-cyan text-cyan bg-cyan/10"
                : "border-border text-muted hover:text-cyan hover:border-cyan/40"
            }`}
          >
            {showReasoning ? "▴ REASONING" : "▾ REASONING"}
          </button>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="px-2 py-1 border border-border text-muted hover:text-green hover:border-green/40 disabled:opacity-50"
          >
            {refreshing ? "⟳ SCANNING…" : "⟳ REFRESH"}
          </button>
        </div>
      </div>

      {/* Reasoning dropdown */}
      {showReasoning && (
        <div className="border border-cyan/30 bg-grid p-3 mb-2">
          <div className="text-[10px] tracking-[1.5px] text-cyan font-bold mb-2">
            ◎ WHAT EVERY TAB, TAG &amp; COLUMN MEANS — AND WHY IT FINDS BIG MOVES
          </div>
          <table className="w-full text-[10px]">
            <tbody>
              {REASONING.map((r) => (
                <tr key={r.term} className="dotted-row align-top">
                  <td className={`py-1.5 pr-3 whitespace-nowrap font-bold ${r.color}`}>
                    {r.term}
                  </td>
                  <td className="py-1.5 pr-3 text-muted leading-relaxed">{r.what}</td>
                  <td className="py-1.5 text-dim leading-relaxed">
                    <span className="text-muted">Why it works:</span> {r.why}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Top pick */}
      {topPick && <TopPick coin={topPick} mode={mode} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-[10px]">
        <div className="flex gap-1">
          {BUCKET_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setBucket(f.key)}
              className={`px-1.5 py-0.5 border ${
                bucket === f.key
                  ? "border-cyan text-cyan bg-cyan/10"
                  : "border-border text-dim hover:text-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {TIER_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setTier(f.key)}
              className={`px-1.5 py-0.5 border ${
                tier === f.key
                  ? "border-amber text-amber bg-amber/10"
                  : "border-border text-dim hover:text-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="border-b border-border text-[9px] tracking-[1px]">
              <th className="px-1.5 py-1 text-left text-muted">#</th>
              <th className="px-1 py-1 text-center text-muted">★</th>
              <th className="px-1.5 py-1 text-left text-muted">COIN</th>
              <th className="px-1.5 py-1 text-right text-muted">PRICE</th>
              <Th k="pct1h" label="1H" />
              <Th k="pct24h" label="24H" />
              <Th k="pct7d" label="7D" />
              <Th k="mcap" label="MCAP" />
              <Th k="volMcap" label="VOL/MC" />
              <Th k="athChangePct" label="FROM ATH" />
              <Th k="upsideMultiple" label="UPSIDE×" />
              <Th k="score" label="SCORE" />
              <th className="px-1.5 py-1 text-left text-muted">FLAGS</th>
              <th className="px-1.5 py-1 text-left text-muted">TAGS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr
                key={c.id}
                onClick={() => router.push(`/guru/crypto/${c.symbol}`)}
                className="dotted-row cursor-pointer hover:bg-amber/5"
              >
                <td className="px-1.5 py-1 text-dim">{i + 1}</td>
                <td className="px-1 py-1 text-center">
                  <button
                    onClick={(e) => togglePin(c, e)}
                    className={`text-[11px] leading-none transition-colors ${
                      pinned.has(c.id) ? "text-amber" : "text-border hover:text-amber/50"
                    }`}
                    title={pinned.has(c.id) ? "Remove from watchlist" : "Add to watchlist"}
                  >
                    ★
                  </button>
                </td>
                <td className="px-1.5 py-1 whitespace-nowrap">
                  <span className="text-white font-bold">{c.symbol}</span>{" "}
                  <span className="text-dim text-[9px]">{c.name.slice(0, 18)}</span>{" "}
                  <span className={`text-[9px] ${TIER_COLOR[c.riskTier]}`}>
                    [{c.riskTier.slice(0, 4).toUpperCase()}]
                  </span>
                </td>
                <td className="px-1.5 py-1 text-right text-muted whitespace-nowrap">
                  {fmtPrice(c.price)}
                </td>
                <td className="px-1.5 py-1 text-right"><Pct v={c.pct1h} /></td>
                <td className="px-1.5 py-1 text-right"><Pct v={c.pct24h} /></td>
                <td className="px-1.5 py-1 text-right"><Pct v={c.pct7d} /></td>
                <td className="px-1.5 py-1 text-right text-muted">{fmtCap(c.mcap)}</td>
                <td className="px-1.5 py-1 text-right text-muted">{c.volMcap.toFixed(2)}</td>
                <td className="px-1.5 py-1 text-right text-red">
                  {c.athChangePct.toFixed(0)}%
                </td>
                <td className="px-1.5 py-1 text-right text-cyan">
                  {c.upsideMultiple.toFixed(1)}×
                </td>
                <td className="px-1.5 py-1 text-right whitespace-nowrap">
                  <span className="text-amber font-bold">{score(c)}</span>
                  {c.socialSurge && <span className="text-fuchsia-400 ml-0.5">▲</span>}
                  <ScoreDelta
                    delta={
                      trends[c.id]
                        ? score(c) - (mode === "moonshot"
                            ? trends[c.id].scoreMoonshot
                            : trends[c.id].scoreScalp)
                        : null
                    }
                  />
                </td>
                <td className="px-1.5 py-1 whitespace-nowrap">
                  {c.rugFlags.map((f) => (
                    <span
                      key={f}
                      className="text-red border border-red/40 px-1 mr-0.5 text-[8px]"
                    >
                      {f}
                    </span>
                  ))}
                </td>
                <td className="px-1.5 py-1 whitespace-nowrap">
                  {c.buckets.map((b) => (
                    <span
                      key={b}
                      className={`border px-1 mr-0.5 text-[8px] ${BUCKET_COLOR[b]}`}
                    >
                      {b}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="text-dim text-[10px] italic p-3">No coins match current filters.</div>
        )}
      </div>
    </div>
  );
}
