"use client";
import { useState, useTransition } from "react";
import { createSubscription } from "./actions";

const CYCLES = ["monthly", "yearly", "weekly", "quarterly"];
const CURRENCIES = ["USD", "SGD", "EUR", "GBP", "JPY", "CNY", "AUD"];

export function AddForm() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      action={(fd) => {
        setErr(null);
        start(async () => {
          const r = await createSubscription(fd);
          if (r && "error" in r && r.error) setErr(r.error);
          else {
            // reset form
            (document.getElementById("sub-form") as HTMLFormElement)?.reset();
          }
        });
      }}
      id="sub-form"
      className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-4 text-[11px]"
    >
      <input
        name="name"
        placeholder="NAME (e.g. Spotify)"
        required
        className="bg-grid border border-border px-2 py-1 text-text uppercase placeholder:text-dim md:col-span-2"
      />
      <input
        name="amount"
        type="number"
        step="0.01"
        min="0.01"
        placeholder="AMOUNT"
        required
        className="bg-grid border border-border px-2 py-1 text-text placeholder:text-dim"
      />
      <select
        name="currency"
        defaultValue="SGD"
        className="bg-grid border border-border px-2 py-1 text-text"
      >
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        name="cycle"
        defaultValue="monthly"
        className="bg-grid border border-border px-2 py-1 text-text uppercase"
      >
        {CYCLES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          name="next_charge"
          type="date"
          className="bg-grid border border-border px-2 py-1 text-text flex-1"
        />
        <button
          type="submit"
          disabled={pending}
          className="bg-amber text-black px-3 font-bold tracking-wider disabled:opacity-50"
        >
          {pending ? "..." : "ADD"}
        </button>
      </div>
      {err && (
        <div className="md:col-span-6 text-red text-[11px]">! {err}</div>
      )}
    </form>
  );
}
