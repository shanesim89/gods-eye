"use client";
import { useState, useTransition, useRef } from "react";
import { updateAsset, deleteAsset } from "./actions";
import { fmtMoney, timeAgo } from "@/lib/format";

const ASSET_CLASSES = ["cash", "equity", "etf", "crypto", "bond", "real_estate", "commodity", "other"];
const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];
const TICKERABLE = new Set(["equity", "etf", "crypto"]);

type Asset = {
  id: string;
  name: string;
  ticker: string | null;
  qty: string | null;
  cost_basis: string | null;
  current_value: string | null;
  currency: string;
  asset_class: string;
  auto_price: boolean;
  last_priced_at: Date | string | null;
  cbBase: number;
  cvBase: number;
  linkedLiabilityId: string | null;
  linkedLiabilityName: string | null;
};

type LiabilityOpt = { id: string; name: string };
const input = "bg-grid border border-border px-1.5 py-0.5 text-text text-[11px]";

export function AssetRow({ a, base, liabilities }: { a: Asset; base: string; liabilities: LiabilityOpt[] }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (editing) {
    return (
      <tr className="dotted-row bg-grid">
        <td colSpan={10} className="py-1.5">
          <form
            ref={formRef}
            action={(fd) => {
              setErr(null);
              // Convert checkbox state to explicit value (unchecked = "false")
              if (!fd.has("auto_price")) fd.set("auto_price", "false");
              start(async () => {
                const r = await updateAsset(a.id, fd);
                if (r && "error" in r && r.error) setErr(r.error);
                else setEditing(false);
              });
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input name="name" defaultValue={a.name} required className={`${input} flex-1 min-w-32 uppercase`} />
            <input name="ticker" defaultValue={a.ticker ?? ""} placeholder="ticker" className={`${input} w-20 uppercase`} />
            <select name="asset_class" defaultValue={a.asset_class} className={`${input} uppercase`}>
              {ASSET_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input name="qty" type="number" step="0.00000001" min="0" defaultValue={a.qty ?? ""} required className={`${input} w-24`} placeholder="qty" />
            <input name="cost_basis" type="number" step="0.01" min="0" defaultValue={a.cost_basis ?? ""} required className={`${input} w-28`} placeholder="cost" />
            <input name="current_value" type="number" step="0.01" min="0" defaultValue={a.current_value ?? ""} className={`${input} w-28`} placeholder="market val" />
            <select name="currency" defaultValue={a.currency} className={input}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="flex items-center gap-1 text-[10px] text-muted">
              <input type="checkbox" name="auto_price" value="true" defaultChecked={a.auto_price} />
              AUTO
            </label>
            <select name="linked_liability_id" defaultValue={a.linkedLiabilityId ?? ""} className={`${input} uppercase`}>
              <option value="">— no link —</option>
              {liabilities.map((l) => <option key={l.id} value={l.id}>↔ {l.name}</option>)}
            </select>
            <button type="submit" disabled={pending} className="text-green text-[11px] px-2 hover:text-amber">{pending ? "…" : "✓ SAVE"}</button>
            <button type="button" onClick={() => setEditing(false)} className="text-muted text-[11px] px-2 hover:text-text">← CANCEL</button>
            {err && <span className="text-red text-[10px]">! {err}</span>}
          </form>
        </td>
      </tr>
    );
  }

  const cv = a.current_value !== null ? Number(a.current_value) : null;
  const cb = Number(a.cost_basis ?? 0);
  const canAutoPrice = TICKERABLE.has(a.asset_class) && !!a.ticker;

  return (
    <tr className="dotted-row">
      <td className="py-1 text-text">{a.name}</td>
      <td className="py-1 pl-3 text-cyan">{a.ticker ?? "—"}</td>
      <td className="py-1 pl-3 text-muted uppercase">{a.asset_class}</td>
      <td className="py-1 pl-3 text-right">{a.qty}</td>
      <td className="py-1 pl-3 text-right">{fmtMoney(cb, a.currency, 2)}</td>
      <td className="py-1 pl-3 text-right">{cv !== null ? fmtMoney(cv, a.currency, 2) : <span className="text-muted">—</span>}</td>
      <td className="py-1 pl-3 text-right text-amber">{fmtMoney(a.cvBase || a.cbBase, base, 0)}</td>
      <td className="py-1 pl-3 text-[10px] whitespace-nowrap">
        {canAutoPrice ? (
          <span className={a.auto_price ? "text-green" : "text-muted"}>
            {a.auto_price ? "☑" : "☐"} {a.last_priced_at ? timeAgo(a.last_priced_at) : "never"}
          </span>
        ) : (
          <span className="text-dim">n/a</span>
        )}
      </td>
      <td className="py-1 pl-3 text-[10px]">
        {a.linkedLiabilityName ? (
          <span style={{ color: "#b066ff" }}>↔ {a.linkedLiabilityName}</span>
        ) : (
          <span className="text-dim">—</span>
        )}
      </td>
      <td className="py-1 pl-3 text-right whitespace-nowrap">
        <button onClick={() => setEditing(true)} className="text-cyan hover:text-amber text-[10px] mr-2" title="edit">✎</button>
        <DeleteBtn id={a.id} />
      </td>
    </tr>
  );
}

function DeleteBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm("Delete asset? Linked liability stays.")) return;
        start(() => deleteAsset(id));
      }}
      disabled={pending}
      className="text-red hover:text-amber text-[10px] disabled:opacity-30"
      title="delete"
    >
      {pending ? "…" : "✕"}
    </button>
  );
}
