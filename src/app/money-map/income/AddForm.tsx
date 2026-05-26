"use client";
import { useState, useTransition } from "react";
import {
  TextInput,
  NumInput,
  Select,
  SubmitBtn,
  CYCLES,
  CURRENCIES,
  INCOME_TYPES,
} from "@/components/ui/FormBits";
import { createIncome } from "./actions";

export function AddForm() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      id="inc-form"
      action={(fd) => {
        setErr(null);
        start(async () => {
          const r = await createIncome(fd);
          if (r && "error" in r && r.error) setErr(r.error);
          else (document.getElementById("inc-form") as HTMLFormElement)?.reset();
        });
      }}
      className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-4 text-[11px]"
    >
      <TextInput name="name" placeholder="SOURCE (ACME CORP, VOO, etc)" required className="uppercase md:col-span-2" />
      <NumInput name="amount" placeholder="AMOUNT" required />
      <Select name="currency" options={CURRENCIES} defaultValue="SGD" uppercase={false} />
      <Select name="cycle" options={CYCLES} defaultValue="monthly" />
      <div className="flex gap-2">
        <Select name="type" options={INCOME_TYPES} defaultValue="salary" className="flex-1" />
        <SubmitBtn pending={pending} />
      </div>
      {err && <div className="md:col-span-6 text-red text-[11px]">! {err}</div>}
    </form>
  );
}
