"use client";
import { useState, useTransition } from "react";
import type { OptionsAnalysis } from "@/lib/options/analytics";
import { ContractSummary } from "./ContractSummary";
import {
  PayoffChart,
  GreeksProfileChart,
  IvSkewChart,
  IvTermChart,
  OpenInterestChart,
  ProbabilityChart,
  ExpectedMoveCone,
} from "./OptionCharts";

export function OptionsWorkspace({ initial }: { initial: OptionsAnalysis }) {
  const [a, setA] = useState<OptionsAnalysis>(initial);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const sel = a.selected;
  const type = sel?.type ?? "C";
  const strike = sel?.strike ?? a.spot;
  const exp = a.expirations.find((e) => e.iso === a.expiryISO)?.unix;

  function reload(next: { type?: "C" | "P"; strike?: number; exp?: number }) {
    const t = next.type ?? type;
    const k = next.strike ?? strike;
    const e = next.exp ?? exp;
    const qs = new URLSearchParams();
    if (e) qs.set("exp", String(e));
    if (k) qs.set("strike", String(k));
    qs.set("type", t);
    setErr(null);
    startTransition(async () => {
      try {
        const r = await fetch(`/api/guru/options/${encodeURIComponent(a.underlying)}?${qs.toString()}`);
        const j = await r.json();
        if (j.ok) setA(j.analysis);
        else setErr(j.error ?? "Failed to load contract");
      } catch {
        setErr("Network error loading contract");
      }
    });
  }

  const selectCls =
    "bg-black border border-border text-text text-[11px] px-2 py-1 outline-none focus:border-amber font-mono";

  return (
    <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
      {/* ── Contract picker ── */}
      <div className="flex flex-wrap items-end gap-3 border border-border bg-grid p-3 mb-3">
        <div className="flex flex-col gap-1">
          <span className="text-dim text-[9px] uppercase tracking-[1px]">Type</span>
          <div className="flex">
            {(["C", "P"] as const).map((tp) => (
              <button
                key={tp}
                onClick={() => reload({ type: tp })}
                className={`px-3 py-1 text-[11px] border border-border font-bold ${
                  type === tp ? (tp === "C" ? "bg-green/20 text-green" : "bg-red/20 text-red") : "text-dim"
                }`}
              >
                {tp === "C" ? "CALL" : "PUT"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-dim text-[9px] uppercase tracking-[1px]">Expiry</span>
          <select className={selectCls} value={exp ?? ""} onChange={(ev) => reload({ exp: Number(ev.target.value) })}>
            {a.expirations.map((e) => (
              <option key={e.unix} value={e.unix}>
                {e.iso}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-dim text-[9px] uppercase tracking-[1px]">Strike</span>
          <select className={selectCls} value={sel?.strike ?? ""} onChange={(ev) => reload({ strike: Number(ev.target.value) })}>
            {a.strikes.map((k) => (
              <option key={k} value={k}>
                {k.toLocaleString("en-US")}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto text-dim text-[9px] text-right leading-relaxed">
          <div>
            source <span className="text-muted uppercase">{a.source}</span>
            {pending && <span className="text-amber ml-2">updating…</span>}
          </div>
          <div>greeks {sel?.greeksSource === "native" ? "from exchange" : "Black-Scholes"}</div>
        </div>
      </div>

      {err && <div className="border border-red/40 bg-red/10 text-red text-[11px] px-3 py-2 mb-3">{err}</div>}

      {/* ── Stat summary ── */}
      <ContractSummary a={a} />

      {/* ── Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <PayoffChart a={a} />
        <ProbabilityChart a={a} />
        <OpenInterestChart a={a} />
        <IvSkewChart a={a} />
        <IvTermChart a={a} />
        <ExpectedMoveCone a={a} />
        <div className="lg:col-span-2">
          <GreeksProfileChart a={a} />
        </div>
      </div>

      <div className="text-dim text-[9px] mt-3 leading-relaxed">
        Decision support only — not advice. IV %ile is a realized-vol-band proxy (true IV-rank needs stored IV history).
        {a.source === "deribit" ? " Crypto premiums converted from coin to USD." : " Equity greeks are Black-Scholes from real IV."}
      </div>
    </div>
  );
}
