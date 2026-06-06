"use client";
import { useState, useTransition } from "react";
import { createAsset } from "./actions";

const ASSET_CLASSES = ["cash", "equity", "etf", "crypto", "bond", "real_estate", "commodity", "other"];
const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];

export function AddForm({ liabilities }: { liabilities: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <form
      action={(fd) => {
        setErr(null);
        setOk(null);
        const name = String(fd.get("name") ?? "").trim() || "asset";
        start(async () => {
          const r = await createAsset(fd);
          if (r && "error" in r && r.error) setErr(r.error);
          else {
            (document.getElementById("asset-form") as HTMLFormElement)?.reset();
            setOk(`✓ added ${name}`);
            setTimeout(() => setOk(null), 3000);
          }
        });
      }}
      id="asset-form"
      className="grid grid-cols-1 md:grid-cols-8 gap-2 mb-4 text-[11px]"
    >
      <input name="name" placeholder="NAME" className="bg-grid border border-border px-2 py-1 text-text uppercase placeholder:text-dim" />
      <input name="ticker" placeholder="TICKER (opt)" className="bg-grid border border-border px-2 py-1 text-text uppercase placeholder:text-dim" />
      <select name="asset_class" defaultValue="equity" className="bg-grid border border-border px-2 py-1 text-text uppercase">
        {ASSET_CLASSES.map((c) => (<option key={c} value={c}>{c}</option>))}
      </select>
      <input name="qty" type="number" step="0.00000001" min="0" placeholder="QTY" required className="bg-grid border border-border px-2 py-1 text-text placeholder:text-dim" />
      <input name="cost_basis" type="number" step="0.01" min="0" placeholder="COST BASIS" required className="bg-grid border border-border px-2 py-1 text-text placeholder:text-dim" />
      <input name="current_value" type="number" step="0.01" min="0" placeholder="MARKET VAL (opt)" className="bg-grid border border-border px-2 py-1 text-text placeholder:text-dim" />
      <select name="currency" defaultValue="SGD" className="bg-grid border border-border px-2 py-1 text-text">
        {CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
      </select>
      <div className="flex gap-2">
        <select name="linked_liability_id" defaultValue="" className="bg-grid border border-border px-2 py-1 text-text uppercase flex-1">
          <option value="">— LINK LIAB? —</option>
          {liabilities.map((l) => (<option key={l.id} value={l.id}>↔ {l.name}</option>))}
        </select>
        <button type="submit" disabled={pending} className="bg-amber text-black px-3 font-bold tracking-wider disabled:opacity-50">
          {pending ? "..." : "ADD"}
        </button>
      </div>
      {err && (<div className="md:col-span-8 text-red text-[11px]">! {err}</div>)}
      {ok && (<div className="md:col-span-8 text-green text-[11px]">{ok}</div>)}
    </form>
  );
}
