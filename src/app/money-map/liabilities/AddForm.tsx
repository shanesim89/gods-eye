"use client";
import { useState, useTransition } from "react";
import { TextInput, NumInput, Select, SubmitBtn, CURRENCIES } from "@/components/ui/FormBits";
import { createLiability } from "./actions";

export function AddForm() {
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
      className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4 text-[11px]"
    >
      <TextInput name="name" placeholder="NAME (home loan, credit card)" required className="uppercase md:col-span-2" />
      <NumInput name="balance" placeholder="BALANCE" required />
      <NumInput name="interest_rate" placeholder="RATE % (opt)" step="0.001" />
      <div className="flex gap-2">
        <Select name="currency" options={CURRENCIES} defaultValue="USD" uppercase={false} className="flex-1" />
        <SubmitBtn pending={pending} />
      </div>
      {err && <div className="md:col-span-5 text-red text-[11px]">! {err}</div>}
    </form>
  );
}
