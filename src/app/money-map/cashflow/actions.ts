"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { fixed_expenses, investment_commitments } from "@/db/schema";
import { requireUser } from "@/lib/auth";

const CYCLES = ["monthly", "yearly", "weekly", "quarterly", "daily"];
const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];

function validate(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const currency = String(formData.get("currency") ?? "SGD");
  const cycle = String(formData.get("cycle") ?? "monthly");

  if (!name) return { error: "name required" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "amount must be > 0" };
  if (!CURRENCIES.includes(currency)) return { error: "invalid currency" };
  if (!CYCLES.includes(cycle)) return { error: "invalid cycle" };
  return { name, amount, currency, cycle };
}

export async function createFixedExpense(formData: FormData) {
  const user = await requireUser();
  const v = validate(formData);
  if ("error" in v) return v;
  await db.insert(fixed_expenses).values({
    user_id: user.id,
    name: v.name,
    amount: String(v.amount),
    currency: v.currency,
    cycle: v.cycle,
  });
  revalidatePath("/money-map/cashflow");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function updateFixedExpense(id: string, formData: FormData) {
  const user = await requireUser();
  const patch: Record<string, unknown> = { updated_at: new Date() };
  const name = formData.get("name");
  if (name !== null) {
    const s = String(name).trim();
    if (!s) return { error: "name required" };
    patch.name = s;
  }
  const amount = formData.get("amount");
  if (amount !== null) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return { error: "amount must be > 0" };
    patch.amount = String(n);
  }
  const currency = formData.get("currency");
  if (currency !== null) {
    const s = String(currency);
    if (!CURRENCIES.includes(s)) return { error: "invalid currency" };
    patch.currency = s;
  }
  const cycle = formData.get("cycle");
  if (cycle !== null) {
    const s = String(cycle);
    if (!CYCLES.includes(s)) return { error: "invalid cycle" };
    patch.cycle = s;
  }
  await db.update(fixed_expenses).set(patch).where(and(eq(fixed_expenses.id, id), eq(fixed_expenses.user_id, user.id)));
  revalidatePath("/money-map/cashflow");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function deleteFixedExpense(id: string) {
  const user = await requireUser();
  await db
    .delete(fixed_expenses)
    .where(and(eq(fixed_expenses.id, id), eq(fixed_expenses.user_id, user.id)));
  revalidatePath("/money-map/cashflow");
  revalidatePath("/money-map");
}

export async function createCommitment(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const target_amount = Number(formData.get("target_amount"));
  const currency = String(formData.get("currency") ?? "SGD");
  const cycle = String(formData.get("cycle") ?? "monthly");

  if (!name) return { error: "name required" };
  if (!Number.isFinite(target_amount) || target_amount <= 0)
    return { error: "target must be > 0" };
  if (!CURRENCIES.includes(currency)) return { error: "invalid currency" };
  if (!CYCLES.includes(cycle)) return { error: "invalid cycle" };

  await db.insert(investment_commitments).values({
    user_id: user.id,
    name,
    target_amount: String(target_amount),
    currency,
    cycle,
  });
  revalidatePath("/money-map/cashflow");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function updateCommitment(id: string, formData: FormData) {
  const user = await requireUser();
  const patch: Record<string, unknown> = { updated_at: new Date() };
  const name = formData.get("name");
  if (name !== null) {
    const s = String(name).trim();
    if (!s) return { error: "name required" };
    patch.name = s;
  }
  const ta = formData.get("target_amount");
  if (ta !== null) {
    const n = Number(ta);
    if (!Number.isFinite(n) || n <= 0) return { error: "target must be > 0" };
    patch.target_amount = String(n);
  }
  const currency = formData.get("currency");
  if (currency !== null) {
    const s = String(currency);
    if (!CURRENCIES.includes(s)) return { error: "invalid currency" };
    patch.currency = s;
  }
  const cycle = formData.get("cycle");
  if (cycle !== null) {
    const s = String(cycle);
    if (!CYCLES.includes(s)) return { error: "invalid cycle" };
    patch.cycle = s;
  }
  await db.update(investment_commitments).set(patch).where(and(eq(investment_commitments.id, id), eq(investment_commitments.user_id, user.id)));
  revalidatePath("/money-map/cashflow");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function deleteCommitment(id: string) {
  const user = await requireUser();
  await db
    .delete(investment_commitments)
    .where(
      and(
        eq(investment_commitments.id, id),
        eq(investment_commitments.user_id, user.id)
      )
    );
  revalidatePath("/money-map/cashflow");
  revalidatePath("/money-map");
}
