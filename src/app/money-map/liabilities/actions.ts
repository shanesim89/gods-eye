"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { liabilities } from "@/db/schema";
import { requireUser } from "@/lib/auth";

const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];

export async function createLiability(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const balance = Number(formData.get("balance"));
  const interest_raw = String(formData.get("interest_rate") ?? "");
  const interest = interest_raw === "" ? null : Number(interest_raw);
  const currency = String(formData.get("currency") ?? "USD");

  if (!name) return { error: "name required" };
  if (!Number.isFinite(balance) || balance <= 0) return { error: "balance must be > 0" };
  if (interest !== null && (!Number.isFinite(interest) || interest < 0))
    return { error: "interest_rate invalid" };
  if (!CURRENCIES.includes(currency)) return { error: "invalid currency" };

  await db.insert(liabilities).values({
    user_id: user.id,
    name,
    balance: String(balance),
    interest_rate: interest !== null ? String(interest) : null,
    currency,
  });

  revalidatePath("/money-map/liabilities");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function deleteLiability(id: string) {
  const user = await requireUser();
  await db
    .delete(liabilities)
    .where(and(eq(liabilities.id, id), eq(liabilities.user_id, user.id)));
  revalidatePath("/money-map/liabilities");
  revalidatePath("/money-map");
}
