"use client";
import { Fragment, useMemo, useState } from "react";
import type { LeaderResult, LeaderRow } from "@/lib/stocks/leaders";
import type { NewsItem } from "@/lib/finnhub";
import type { YahooSummary } from "@/lib/yahoo";
import { AnalystCard } from "@/app/guru/_components/AnalystCard";

type SortKey = "leader_score" | "mom_12_1" | "near_high_pct" | "rs_spy" | "momentum_score" | "growth_score";

type Detail = { news: NewsItem[]; summary: YahooSummary | null };

const Pct = ({ v, dec = 1 }: { v: number | null; dec?: number }) =>
  v == null ? (
    <span className="text-dim">—</span>
  ) : (
    <span className={v > 0 ? "text-green" : v < 0 ? "text-red" : "text-muted"}>
      {v > 0 ? "+" : ""}
      {v.toFixed(dec)}%
    </span>
  );

const scoreColor = (s: number) => (s >= 75 ? "#00ff7f" : s >= 50 ? "#ffb000" : "#909090");

function briefing(r: LeaderRow): string {
  const parts: string[] = [];
  parts.push(`Up ${r.mom_12_1.toFixed(0)}% over the last 12 months (12-1)`);
  parts.push(
    r.near_high_pct >= -1 ? "right at its 52-week high" : `${Math.abs(r.near_high_pct).toFixed(0)}% off its 52-week high`
  );
  if (r.rs_spy > 0) parts.push(`outperforming SPY by ${r.rs_spy.toFixed(0)} pts (6mo)`);
  if (r.ma_stack) parts.push("Stage-2 uptrend (price > MA50 > MA200, MA50 rising)");
  if (r.growth_available) {
    const g: string[] = [];
    if (r.revenue_growth != null) g.push(`rev ${r.revenue_growth > 0 ? "+" : ""}${r.revenue_growth.toFixed(0)}%`);
    if (r.earnings_growth != null) g.push(`EPS ${r.earnings_growth > 0 ? "+" : ""}${r.earnings_growth.toFixed(0)}%`);
    if (g.length) parts.push(`${g.join(" / ")} YoY`);
  }
  parts.push(
    r.tag === "EARLY"
      ? "EARLY — not extended, better entry"
      : "EXTENDED — strong but stretched above MA50, chase risk"
  );
  return parts.join(" · ") + ".";
}

export function LeadersTable({ initial }: { initial: LeaderResult | null }) {
  const [sort, setSort] = useState<SortKey>("leader_score");
  const [asc, setAsc] = useState(false);
  const [openSym, setOpenSym] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, Detail | "loading">>({});
  const [tab, setTab] = useState<"news" | "analyst">("news");

  const rows = useMemo(() => {
    const r = [...(initial?.rows ?? [])];
    r.sort((a, b) => (asc ? a[sort] - b[sort] : b[sort] - a[sort]));
    return r;
  }, [initial, sort, asc]);

  const setSortKey = (k: SortKey) => {
    if (k === sort) setAsc((v) => !v);
    else {
      setSort(k);
      setAsc(false);
    }
  };

  const openRow = async (sym: string) => {
    if (openSym === sym) {
      setOpenSym(null);
      return;
    }
    setOpenSym(sym);
    setTab("news");
    if (!detail[sym]) {
      setDetail((d) => ({ ...d, [sym]: "loading" }));
      try {
        const r = await fetch(`/api/stocks/dip-bounce/${sym}`);
        const j = (await r.json()) as Detail;
        setDetail((d) => ({ ...d, [sym]: j }));
      } catch {
        setDetail((d) => ({ ...d, [sym]: { news: [], summary: null } }));
      }
    }
  };

  if (!initial || rows.length === 0) {
    return (
      <div className="text-red text-[11px] italic border border-red/40 bg-red/5 p-3">
        ⚠ No leaders snapshot yet — the daily Python scan (dipbounce.scanner) hasn't published
        leaders:v1 to Neon. Run it once to populate.
      </div>
    );
  }

  const top = rows[0];
  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th
      onClick={() => setSortKey(k)}
      className="px-1.5 py-1 text-right cursor-pointer hover:text-amber select-none"
    >
      {children} {sort === k ? (asc ? "▲" : "▼") : ""}
    </th>
  );

  return (
    <div className="text-[11px]">
      <div className="border border-green/40 bg-green/5 p-2.5 mb-3">
        <div className="flex items-center justify-between">
          <span className="text-green font-bold tracking-[1px]">★ TOP LEADER — {top.symbol}</span>
          <span className="text-dim text-[9px]">{initial.passed} uptrends · {initial.universe} scanned</span>
        </div>
        <div className="text-dim text-[10px] mt-1 leading-relaxed">{briefing(top)}</div>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="text-muted text-[9px] uppercase tracking-[0.5px] border-b border-border">
            <th className="px-1.5 py-1 text-left">Sym</th>
            <th className="px-1.5 py-1 text-right">Price</th>
            <Th k="mom_12_1">12-1 Mom</Th>
            <Th k="near_high_pct">vs 52wH</Th>
            <Th k="rs_spy">RS·SPY</Th>
            <Th k="growth_score">Rev/EPS</Th>
            <Th k="leader_score">Score</Th>
            <th className="px-1.5 py-1 text-right">Tag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = openSym === r.symbol;
            const d = detail[r.symbol];
            return (
              <Fragment key={r.symbol}>
                <tr onClick={() => openRow(r.symbol)} className="border-b border-border/40 cursor-pointer hover:bg-amber/5">
                  <td className="px-1.5 py-1 text-left text-text font-bold">{r.symbol}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-muted">${r.price.toFixed(2)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><Pct v={r.mom_12_1} dec={0} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><Pct v={r.near_high_pct} dec={0} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><Pct v={r.rs_spy} dec={0} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {r.growth_available ? (
                      <span>
                        <Pct v={r.revenue_growth} dec={0} />
                        <span className="text-dim"> / </span>
                        <Pct v={r.earnings_growth} dec={0} />
                      </span>
                    ) : (
                      <span className="text-dim" title="price-only (no fundamentals)">px</span>
                    )}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums font-bold" style={{ color: scoreColor(r.leader_score) }}>
                    {r.leader_score.toFixed(0)}
                  </td>
                  <td className="px-1.5 py-1 text-right">
                    <span
                      className={`border px-1 text-[8px] ${
                        r.tag === "EARLY" ? "text-green border-green/40" : "text-amber border-amber/40"
                      }`}
                    >
                      {r.tag}
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${r.symbol}-detail`}>
                    <td colSpan={8} className="bg-grid border-b border-border p-3">
                      <div className="text-dim text-[10px] leading-relaxed mb-3">
                        <span className="text-muted">◎ BRIEFING</span> — {briefing(r)}
                      </div>

                      <div className="flex gap-2 mb-2">
                        {(["news", "analyst"] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`px-2 py-0.5 text-[9px] uppercase tracking-[1px] border ${
                              tab === t ? "border-amber text-amber bg-amber/10" : "border-border text-dim hover:text-muted"
                            }`}
                          >
                            {t === "news" ? "News" : "Analyst"}
                          </button>
                        ))}
                      </div>

                      {d === "loading" || d === undefined ? (
                        <div className="text-dim text-[10px] italic">Loading…</div>
                      ) : tab === "news" ? (
                        d.news.length === 0 ? (
                          <div className="text-dim text-[10px] italic">No recent news.</div>
                        ) : (
                          <div className="space-y-1.5">
                            {d.news.slice(0, 8).map((nws, i) => (
                              <a
                                key={i}
                                href={nws.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block text-[10px] text-muted hover:text-amber"
                              >
                                <span className="text-dim">{nws.source}</span> · {nws.headline}
                              </a>
                            ))}
                          </div>
                        )
                      ) : d.summary ? (
                        <AnalystCard summary={d.summary} price={r.price} currency="USD" currencySymbol="$" />
                      ) : (
                        <div className="text-dim text-[10px] italic">Analyst ratings unavailable.</div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
