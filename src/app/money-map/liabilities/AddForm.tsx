"use client";
import { useState, useTransition } from "react";
import { createLiability } from "./actions";

const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];

export function AddForm({ assets }: { assets: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      id="lia-form"
      action={(fd) => {
        setErr(null);
        start(async () => {
          const r = await createLiability(fd);
          if (r && "error" in r && r.error) setErr(r.error);
          else (document.getElementById("lia-form") as HTMLFormElement)?.reset();
        });
      }}
      className="grid grid-cols-1 md:grid-cols-7 gap-2 mb-4 text-[11px]"
    >
      <input name="name" placeholder="NAME (home loan, credit card)" required className="bg-grid border border-border px-2 py-1 text-text uppercase placeholder:text-dim md:col-span-2" />
      <input name="balance" type="number" step="0.01" min="0" placeholder="BALANCE" required className="bg-grid border border-border px-2 py-1 text-text placeholder:text-dim" />
      <input name="interest_rate" type="number" step="0.001" min="0" placeholder="RATE % (opt)" className="bg-grid border border-border px-2 py-1 text-text placeholder:text-dim" />
      <input name="monthly_payment" type="number" step="0.01" min="0" placeholder="MO PAYMENT (opt)" className="bg-grid border border-border px-2 py-1 text-text placeholder:text-dim" />
      <select name="currency" defaultValue="SGD" className="bg-grid border border-border px-2 py-1 text-text">
        {CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
      </select>
      <div className="flex gap-2">
        <select name="linked_asset_id" defaultValue="" className="bg-grid border border-border px-2 py-1 text-text uppercase flex-1">
          <option value="">— LINK ASSET? —</option>
          {assets.map((a) => (<option key={a.id} value={a.id}>↔ {a.name}</option>))}
        </select>
        <button type="submit" disabled={pending} className="bg-amber text-black px-3 font-bold tracking-wider disabled:opacity-50">{pending ? "..." : "ADD"}</button>
      </div>
      {err && <div className="md:col-span-7 text-red text-[11px]">! {err}</div>}
    </form>
  );
}
