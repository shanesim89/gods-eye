"use client";
import { useState, useTransition, useRef } from "react";
import { updateSubscription, deleteSubscription } from "./actions";
import { fmtMoney, daysUntil } from "@/lib/format";

const CYCLES = ["monthly", "yearly", "weekly", "quarterly", "daily"];
const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];

type Sub = {
  id: string;
  name: string;
  amount: string;
  currency: string;
  cycle: string;
  next_charge: Date | string | null;
  monthlyBase: number;
};

const input = "bg-grid border border-border px-1.5 py-0.5 text-text text-[11px]";

export function SubRow({ s, base }: { s: Sub; base: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (editing) {
    return (
      <tr className="dotted-row bg-grid">
        <td colSpan={6} className="py-1.5">
          <form
            ref={formRef}
            action={(fd) => {
              setErr(null);
              start(async () => {
                const r = await updateSubscription(s.id, fd);
                if (r && "error" in r && r.error) setErr(r.error);
                else setEditing(false);
              });
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input name="name" defaultValue={s.name} required className={`${input} flex-1 min-w-32`} />
            <input name="amount" type="number" step="0.01" min="0.01" defaultValue={s.amount} required className={`${input} w-24`} />
            <select name="currency" defaultValue={s.currency} className={input}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select name="cycle" defaultValue={s.cycle} className={`${input} uppercase`}>
              {CYCLES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              name="next_charge"
              type="date"
              defaultValue={s.next_charge ? new Date(s.next_charge).toISOString().slice(0, 10) : ""}
              className={input}
            />
            <button type="submit" disabled={pending} className="text-green text-[11px] px-2 hover:text-amber">
              {pending ? "…" : "✓ SAVE"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-muted text-[11px] px-2 hover:text-text">
              ← CANCEL
            </button>
            {err && <span className="text-red text-[10px]">! {err}</span>}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="dotted-row group">
      <td className="py-1 text-text">{s.name}</td>
      <td className="py-1 text-right">{fmtMoney(Number(s.amount), s.currency, 2)}</td>
      <td className="py-1 pl-3 text-muted uppercase">{s.cycle}</td>
      <td className="py-1 pl-3 text-right text-amber">{fmtMoney(s.monthlyBase, base, 2)}</td>
      <td className="py-1 pl-3 text-right text-cyan">{daysUntil(s.next_charge)}</td>
      <td className="py-1 pl-3 text-right whitespace-nowrap">
        <button onClick={() => setEditing(true)} className="text-cyan hover:text-amber text-[10px] mr-2" title="edit">✎</button>
        <DeleteBtn id={s.id} />
      </td>
    </tr>
  );
}

function DeleteBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm("Delete subscription?")) return;
        start(() => deleteSubscription(id));
      }}
      disabled={pending}
      className="text-red hover:text-amber text-[10px] disabled:opacity-30"
      title="delete"
    >
      {pending ? "…" : "✕"}
    </button>
  );
}
