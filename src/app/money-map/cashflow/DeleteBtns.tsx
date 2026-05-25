"use client";
import { useTransition } from "react";
import { deleteFixedExpense, deleteCommitment } from "./actions";

export function DelFx({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => deleteFixedExpense(id))}
      disabled={pending}
      className="text-red hover:text-amber text-[10px] disabled:opacity-30"
    >
      {pending ? "…" : "✕"}
    </button>
  );
}

export function DelIc({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => deleteCommitment(id))}
      disabled={pending}
      className="text-red hover:text-amber text-[10px] disabled:opacity-30"
    >
      {pending ? "…" : "✕"}
    </button>
  );
}
