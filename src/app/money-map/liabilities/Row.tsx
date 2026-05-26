"use client";
import { useState, useTransition } from "react";
import { updateLiability, deleteLiability } from "./actions";
import { fmtMoney, fmtPct } from "@/lib/format";

const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];

type Lia = {
  id: string;
  name: string;
  balance: string;
  interest_rate: string | null;
  monthly_payment: string | null;
  currency: string;
  linked_asset_id: string | null;
  balBase: number;
  linkedAssetName: string | null;
  linkedAssetValueBase: number | null;
};

type AssetOpt = { id: string; name: string };
const input = "bg-grid border border-border px-1.5 py-0.5 text-text text-[11px]";

export function LiaRow({ l, base, assetOpts }: { l: Lia; base: string; assetOpts: AssetOpt[] }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (editing) {
    return (
      <tr className="dotted-row bg-grid">
        <td colSpan={8} className="py-1.5">
          <form
            action={(fd) => {
              setErr(null);
              start(async () => {
                const r = await updateLiability(l.id, fd);
                if (r && "error" in r && r.error) setErr(r.error);
                else setEditing(false);
              });
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input name="name" defaultValue={l.name} required className={`${input} flex-1 min-w-32 uppercase`} />
            <input name="balance" type="number" step="0.01" min="0" defaultValue={l.balance} required className={`${input} w-28`} placeholder="balance" />
            <input name="interest_rate" type="number" step="0.001" min="0" defaultValue={l.interest_rate ?? ""} className={`${input} w-20`} placeholder="rate %" />
            <input name="monthly_payment" type="number" step="0.01" min="0" defaultValue={l.monthly_payment ?? ""} className={`${input} w-24`} placeholder="mo pmt" />
            <select name="currency" defaultValue={l.currency} className={input}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select name="linked_asset_id" defaultValue={l.linked_asset_id ?? ""} className={`${input} uppercase`}>
              <option value="">— no link —</option>
              {assetOpts.map((a) => <option key={a.id} value={a.id}>↔ {a.name}</option>)}
            </select>
            <button type="submit" disabled={pending} className="text-green text-[11px] px-2 hover:text-amber">{pending ? "…" : "✓ SAVE"}</button>
            <button type="button" onClick={() => setEditing(false)} className="text-muted text-[11px] px-2 hover:text-text">← CANCEL</button>
            {err && <span className="text-red text-[10px]">! {err}</span>}
          </form>
        </td>
      </tr>
    );
  }

  // equity calc if linked
  const equity = l.linkedAssetValueBase !== null ? l.linkedAssetValueBase - l.balBase : null;

  return (
    <tr className="dotted-row">
      <td className="py-1 text-text">{l.name}</td>
      <td className="py-1 text-right">{fmtMoney(Number(l.balance), l.currency, 2)}</td>
      <td className="py-1 pl-3 text-right text-muted">{l.interest_rate ? fmtPct(Number(l.interest_rate)) : "—"}</td>
      <td className="py-1 pl-3 text-right">{l.monthly_payment ? fmtMoney(Number(l.monthly_payment), l.currency, 2) : "—"}</td>
      <td className="py-1 pl-3 text-right text-red">{fmtMoney(l.balBase, base, 2)}</td>
      <td className="py-1 pl-3 text-[10px]">
        {l.linkedAssetName ? (
          <span style={{ color: "#b066ff" }}>↔ {l.linkedAssetName}</span>
        ) : (<span className="text-dim">—</span>)}
      </td>
      <td className="py-1 pl-3 text-right">
        {equity !== null ? (
          <span className={equity >= 0 ? "text-green" : "text-red"}>{fmtMoney(equity, base, 0)}</span>
        ) : (<span className="text-dim">—</span>)}
      </td>
      <td className="py-1 pl-3 text-right whitespace-nowrap">
        <button onClick={() => setEditing(true)} className="text-cyan hover:text-amber text-[10px] mr-2" title="edit">✎</button>
        <DeleteBtn id={l.id} />
      </td>
    </tr>
  );
}

function DeleteBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm("Delete liability?")) return;
        start(() => deleteLiability(id));
      }}
      disabled={pending}
      className="text-red hover:text-amber text-[10px] disabled:opacity-30"
      title="delete"
    >
      {pending ? "…" : "✕"}
    </button>
  );
}
