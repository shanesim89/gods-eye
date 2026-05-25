"use client";
import { useState, useTransition } from "react";
import { createAsset } from "./actions";

const ASSET_CLASSES = [
  "cash",
  "equity",
  "etf",
  "crypto",
  "bond",
  "real_estate",
  "commodity",
  "other",
];
const CURRENCIES = ["USD", "SGD", "EUR", "GBP", "JPY", "CNY", "AUD"];

export function AddForm() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      action={(fd) => {
        setErr(null);
        start(async () => {
          const r = await createAsset(fd);
          if (r && "error" in r && r.error) setErr(r.error);
          else
            (document.getElementById("asset-form") as HTMLFormElement)?.reset();
        });
      }}
      id="asset-form"
      className="grid grid-cols-1 md:grid-cols-7 gap-2 mb-4 text-[11px]"
    >
      <input
        name="name"
        placeholder="NAME"
        className="bg-grid border border-border px-2 py-1 text-text uppercase placeholder:text-dim"
      />
      <input
        name="ticker"
        placeholder="TICKER (opt)"
        className="bg-grid border border-border px-2 py-1 text-text uppercase placeholder:text-dim"
      />
      <select
        name="asset_class"
        defaultValue="equity"
        className="bg-grid border border-border px-2 py-1 text-text uppercase"
      >
        {ASSET_CLASSES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        name="qty"
        type="number"
        step="0.00000001"
        min="0"
        placeholder="QTY"
        required
        className="bg-grid border border-border px-2 py-1 text-text placeholder:text-dim"
      />
      <input
        name="cost_basis"
        type="number"
        step="0.01"
        min="0"
        placeholder="COST BASIS (TOTAL)"
        required
        className="bg-grid border border-border px-2 py-1 text-text placeholder:text-dim"
      />
      <select
        name="currency"
        defaultValue="USD"
        className="bg-grid border border-border px-2 py-1 text-text"
      >
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="bg-amber text-black px-3 font-bold tracking-wider disabled:opacity-50"
      >
        {pending ? "..." : "ADD"}
      </button>
      {err && (
        <div className="md:col-span-7 text-red text-[11px]">! {err}</div>
      )}
    </form>
  );
}
