"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { subscriptions } from "@/db/schema";
import { requireUser } from "@/lib/auth";

const CYCLES = ["monthly", "yearly", "weekly", "quarterly", "daily"] as const;
const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];

export async function createSubscription(formData: FormData) {
  const user = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  const amount = String(formData.get("amount") ?? "");
  const currency = String(formData.get("currency") ?? "SGD");
  const cycle = String(formData.get("cycle") ?? "monthly");
  const nextChargeRaw = String(formData.get("next_charge") ?? "");

  if (!name) return { error: "name required" };
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { error: "amount must be > 0" };
  if (!CURRENCIES.includes(currency)) return { error: "invalid currency" };
  if (!CYCLES.includes(cycle as (typeof CYCLES)[number]))
    return { error: "invalid cycle" };

  const next_charge = nextChargeRaw ? new Date(nextChargeRaw) : null;

  await db.insert(subscriptions).values({
    user_id: user.id,
    name,
    amount: String(amt),
    currency,
    cycle,
    next_charge,
  });

  revalidatePath("/money-map/subscriptions");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function updateSubscription(id: string, formData: FormData) {
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
    if (!CYCLES.includes(s as (typeof CYCLES)[number])) return { error: "invalid cycle" };
    patch.cycle = s;
  }
  const next = formData.get("next_charge");
  if (next !== null) {
    const s = String(next);
    patch.next_charge = s === "" ? null : new Date(s);
  }

  await db.update(subscriptions).set(patch).where(and(eq(subscriptions.id, id), eq(subscriptions.user_id, user.id)));
  revalidatePath("/money-map/subscriptions");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function deleteSubscription(id: string) {
  const user = await requireUser();
  await db
    .delete(subscriptions)
    .where(
      and(eq(subscriptions.id, id), eq(subscriptions.user_id, user.id))
    );
  revalidatePath("/money-map/subscriptions");
  revalidatePath("/money-map");
}
