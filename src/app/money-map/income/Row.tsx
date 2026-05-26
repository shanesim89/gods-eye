"use client";
import { useState, useTransition } from "react";
import { updateIncome, deleteIncome } from "./actions";
import { fmtMoney } from "@/lib/format";

const CYCLES = ["monthly", "yearly", "weekly", "quarterly", "daily"];
const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];
const TYPES = ["salary", "dividend", "interest", "rental", "side", "other"];

type Inc = {
  id: string;
  name: string;
  amount: string;
  currency: string;
  cycle: string;
  type: string;
  monthly: number;
};

const input = "bg-grid border border-border px-1.5 py-0.5 text-text text-[11px]";

export function IncRow({ r, base }: { r: Inc; base: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (editing) {
    return (
      <tr className="dotted-row bg-grid">
        <td colSpan={6} className="py-1.5">
          <form
            action={(fd) => {
              setErr(null);
              start(async () => {
                const res = await updateIncome(r.id, fd);
                if (res && "error" in res && res.error) setErr(res.error);
                else setEditing(false);
              });
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input name="name" defaultValue={r.name} required className={`${input} flex-1 min-w-32 uppercase`} />
            <select name="type" defaultValue={r.type} className={`${input} uppercase`}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input name="amount" type="number" step="0.01" min="0.01" defaultValue={r.amount} required className={`${input} w-24`} />
            <select name="currency" defaultValue={r.currency} className={input}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select name="cycle" defaultValue={r.cycle} className={`${input} uppercase`}>
              {CYCLES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="submit" disabled={pending} className="text-green text-[11px] px-2 hover:text-amber">{pending ? "…" : "✓ SAVE"}</button>
            <button type="button" onClick={() => setEditing(false)} className="text-muted text-[11px] px-2 hover:text-text">← CANCEL</button>
            {err && <span className="text-red text-[10px]">! {err}</span>}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="dotted-row">
      <td className="py-1 text-text">{r.name}</td>
      <td className="py-1 pl-3 text-muted uppercase">{r.type}</td>
      <td className="py-1 pl-3 text-right">{fmtMoney(Number(r.amount), r.currency, 2)}</td>
      <td className="py-1 pl-3 text-muted uppercase">{r.cycle}</td>
      <td className="py-1 pl-3 text-right text-green">{fmtMoney(r.monthly, base, 2)}</td>
      <td className="py-1 pl-3 text-right whitespace-nowrap">
        <button onClick={() => setEditing(true)} className="text-cyan hover:text-amber text-[10px] mr-2">✎</button>
        <DelBtn id={r.id} />
      </td>
    </tr>
  );
}

function DelBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => { if (!confirm("Delete income source?")) return; start(() => deleteIncome(id)); }}
      disabled={pending}
      className="text-red hover:text-amber text-[10px] disabled:opacity-30"
    >
      {pending ? "…" : "✕"}
    </button>
  );
}
