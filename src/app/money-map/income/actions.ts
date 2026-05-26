"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { income_sources } from "@/db/schema";
import { requireUser } from "@/lib/auth";

const CYCLES = ["monthly", "yearly", "weekly", "quarterly", "daily"];
const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];
const TYPES = ["salary", "dividend", "interest", "rental", "side", "other"];

export async function createIncome(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const currency = String(formData.get("currency") ?? "SGD");
  const cycle = String(formData.get("cycle") ?? "monthly");
  const type = String(formData.get("type") ?? "salary");

  if (!name) return { error: "name required" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "amount must be > 0" };
  if (!CURRENCIES.includes(currency)) return { error: "invalid currency" };
  if (!CYCLES.includes(cycle)) return { error: "invalid cycle" };
  if (!TYPES.includes(type)) return { error: "invalid type" };

  await db.insert(income_sources).values({
    user_id: user.id,
    name,
    amount: String(amount),
    currency,
    cycle,
    type,
  });
  revalidatePath("/money-map/income");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function updateIncome(id: string, formData: FormData) {
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
  const type = formData.get("type");
  if (type !== null) {
    const s = String(type);
    if (!TYPES.includes(s)) return { error: "invalid type" };
    patch.type = s;
  }

  await db.update(income_sources).set(patch).where(and(eq(income_sources.id, id), eq(income_sources.user_id, user.id)));
  revalidatePath("/money-map/income");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function deleteIncome(id: string) {
  const user = await requireUser();
  await db
    .delete(income_sources)
    .where(and(eq(income_sources.id, id), eq(income_sources.user_id, user.id)));
  revalidatePath("/money-map/income");
  revalidatePath("/money-map");
}
