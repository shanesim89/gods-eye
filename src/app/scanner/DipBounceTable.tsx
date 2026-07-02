"use client";
import { Fragment, useMemo, useState } from "react";
import type { DipResult, DipRow } from "@/lib/stocks/dip-bounce";
import type { NewsItem } from "@/lib/finnhub";
import type { YahooSummary } from "@/lib/yahoo";
import { AnalystCard } from "@/app/guru/_components/AnalystCard";

type SortKey = "bounce_score" | "drop_pct" | "dip_signal_pct" | "bounce_probability" | "rsi";

type Detail = { news: NewsItem[]; summary: YahooSummary | null };

const Pct = ({ v, dec = 1 }: { v: number; dec?: number }) => (
  <span className={v > 0 ? "text-green" : v < 0 ? "text-red" : "text-muted"}>
    {v > 0 ? "+" : ""}
    {v.toFixed(dec)}%
  </span>
);

const scoreColor = (s: number) => (s >= 65 ? "#00ff7f" : s >= 45 ? "#ffb000" : "#909090");

function briefing(r: DipRow): string {
  const parts: string[] = [];
  parts.push(`Down ${Math.abs(r.drop_pct).toFixed(1)}% from its 6-month high`);
  parts.push(
    r.dip_signal_pct < 0
      ? `stretched ${Math.abs(r.dip_signal_pct).toFixed(1)}% below its 20-day average`
      : `back near its 20-day average`
  );
  if (r.rsi < 35) parts.push(`RSI ${r.rsi.toFixed(0)} (oversold)`);
  else if (r.rsi < 50) parts.push(`RSI ${r.rsi.toFixed(0)} (turning up)`);
  else parts.push(`RSI ${r.rsi.toFixed(0)}`);
  if (r.vol_ratio < 1) parts.push(`volume contracting (×${r.vol_ratio.toFixed(2)}) → seller exhaustion / accumulation`);
  if (r.near_support) parts.push(`sitting near prior support`);
  return parts.join(" · ") + ".";
}

export function DipBounceTable({ initial }: { initial: DipResult | null }) {
  const [sort, setSort] = useState<SortKey>("bounce_score");
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
        ⚠ No dip-bounce snapshot yet — the daily Python scan (dipbounce.scanner) hasn't
        published to Neon. Run it once to populate.
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
      {/* Top pick */}
      <div className="border border-green/40 bg-green/5 p-2.5 mb-3">
        <div className="flex items-center justify-between">
          <span className="text-green font-bold tracking-[1px]">★ TOP BOUNCE — {top.symbol}</span>
          <span className="text-dim text-[9px]">
            {initial.passed} dipped · {initial.universe} scanned
          </span>
        </div>
        <div className="text-dim text-[10px] mt-1 leading-relaxed">{briefing(top)}</div>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="text-muted text-[9px] uppercase tracking-[0.5px] border-b border-border">
            <th className="px-1.5 py-1 text-left">Sym</th>
            <th className="px-1.5 py-1 text-right">Price</th>
            <Th k="drop_pct">Drop</Th>
            <Th k="dip_signal_pct">vs MA20</Th>
            <Th k="rsi">RSI</Th>
            <Th k="bounce_score">Bounce</Th>
            <Th k="bounce_probability">Prob</Th>
            <th className="px-1.5 py-1 text-right">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = openSym === r.symbol;
            const d = detail[r.symbol];
            return (
              <Fragment key={r.symbol}>
                <tr
                  onClick={() => openRow(r.symbol)}
                  className="border-b border-border/40 cursor-pointer hover:bg-amber/5"
                >
                  <td className="px-1.5 py-1 text-left text-text font-bold">{r.symbol}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-muted">${r.price.toFixed(2)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><Pct v={r.drop_pct} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><Pct v={r.dip_signal_pct} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-muted">{r.rsi.toFixed(0)}</td>
                  <td
                    className="px-1.5 py-1 text-right tabular-nums font-bold"
                    style={{ color: scoreColor(r.bounce_score) }}
                  >
                    {r.bounce_score.toFixed(0)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-cyan">
                    {(r.bounce_probability * 100).toFixed(0)}%
                  </td>
                  <td className="px-1.5 py-1 text-right">
                    {r.deep_dip && r.high_bounce ? (
                      <span className="text-green border border-green/40 px-1 text-[8px]">✓ DEEP·BOUNCE</span>
                    ) : r.deep_dip ? (
                      <span className="text-red border border-red/40 px-1 text-[8px]">DEEP DIP</span>
                    ) : r.high_bounce ? (
                      <span className="text-amber border border-amber/40 px-1 text-[8px]">HIGH BOUNCE</span>
                    ) : null}
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
                              tab === t
                                ? "border-amber text-amber bg-amber/10"
                                : "border-border text-dim hover:text-muted"
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
                        <AnalystCard
                          summary={d.summary}
                          price={r.price}
                          currency="USD"
                          currencySymbol="$"
                        />
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
