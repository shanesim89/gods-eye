"use client";
import { useState, useTransition } from "react";
import {
  TextInput,
  NumInput,
  Select,
  SubmitBtn,
  CYCLES,
  CURRENCIES,
} from "@/components/ui/FormBits";
import { createFixedExpense, createCommitment } from "./actions";

export function FixedExpenseForm() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      id="fx-form"
      action={(fd) => {
        setErr(null);
        start(async () => {
          const r = await createFixedExpense(fd);
          if (r && "error" in r && r.error) setErr(r.error);
          else (document.getElementById("fx-form") as HTMLFormElement)?.reset();
        });
      }}
      className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4 text-[11px]"
    >
      <TextInput name="name" placeholder="NAME (rent, internet, etc)" required className="uppercase md:col-span-2" />
      <NumInput name="amount" placeholder="AMOUNT" required />
      <Select name="currency" options={CURRENCIES} defaultValue="SGD" uppercase={false} />
      <div className="flex gap-2">
        <Select name="cycle" options={CYCLES} defaultValue="monthly" className="flex-1" />
        <SubmitBtn pending={pending} />
      </div>
      {err && <div className="md:col-span-5 text-red text-[11px]">! {err}</div>}
    </form>
  );
}

export function CommitmentForm() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      id="ic-form"
      action={(fd) => {
        setErr(null);
        start(async () => {
          const r = await createCommitment(fd);
          if (r && "error" in r && r.error) setErr(r.error);
          else (document.getElementById("ic-form") as HTMLFormElement)?.reset();
        });
      }}
      className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4 text-[11px]"
    >
      <TextInput name="name" placeholder="NAME (VOO DCA, BTC DCA, etc)" required className="uppercase md:col-span-2" />
      <NumInput name="target_amount" placeholder="TARGET AMOUNT" required />
      <Select name="currency" options={CURRENCIES} defaultValue="SGD" uppercase={false} />
      <div className="flex gap-2">
        <Select name="cycle" options={CYCLES} defaultValue="monthly" className="flex-1" />
        <SubmitBtn pending={pending} />
      </div>
      {err && <div className="md:col-span-5 text-red text-[11px]">! {err}</div>}
    </form>
  );
}
