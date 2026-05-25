"use client";
import { useTransition } from "react";
import { deleteIncome } from "./actions";

export function DeleteBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => deleteIncome(id))}
      disabled={pending}
      className="text-red hover:text-amber text-[10px] disabled:opacity-30"
    >
      {pending ? "…" : "✕"}
    </button>
  );
}
