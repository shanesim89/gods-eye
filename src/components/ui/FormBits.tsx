"use client";
import { useTransition } from "react";

export const CYCLES = ["monthly", "yearly", "weekly", "quarterly", "daily"] as const;
export const CURRENCIES = ["USD", "SGD", "EUR", "GBP", "JPY", "CNY", "AUD"] as const;
export const INCOME_TYPES = ["salary", "dividend", "interest", "rental", "side", "other"] as const;

const baseInput =
  "bg-grid border border-border px-2 py-1 text-text placeholder:text-dim";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${baseInput} ${props.className ?? ""}`} />;
}

export function NumInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      step="0.01"
      min="0"
      {...props}
      className={`${baseInput} ${props.className ?? ""}`}
    />
  );
}

export function Select({
  name,
  options,
  defaultValue,
  className,
  uppercase = true,
}: {
  name: string;
  options: readonly string[];
  defaultValue?: string;
  className?: string;
  uppercase?: boolean;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className={`${baseInput} ${uppercase ? "uppercase" : ""} ${className ?? ""}`}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function SubmitBtn({ pending, label = "ADD" }: { pending: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-amber text-black px-3 font-bold tracking-wider disabled:opacity-50"
    >
      {pending ? "..." : label}
    </button>
  );
}

export function DeleteAction({
  onDelete,
}: {
  onDelete: () => Promise<void> | void;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => Promise.resolve(onDelete()))}
      disabled={pending}
      className="text-red hover:text-amber text-[10px] disabled:opacity-30"
    >
      {pending ? "…" : "✕"}
    </button>
  );
}
