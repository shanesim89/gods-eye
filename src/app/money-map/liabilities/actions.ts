"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { liabilities, assets } from "@/db/schema";
import { requireUser } from "@/lib/auth";

const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];

function parseNum(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function createLiability(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const balance = Number(formData.get("balance"));
  const interest = parseNum(formData.get("interest_rate"));
  const monthly_payment = parseNum(formData.get("monthly_payment"));
  const currency = String(formData.get("currency") ?? "SGD");
  const linked_asset_raw = String(formData.get("linked_asset_id") ?? "");
  const linked_asset_id = linked_asset_raw && linked_asset_raw !== "" ? linked_asset_raw : null;

  if (!name) return { error: "name required" };
  if (!Number.isFinite(balance) || balance <= 0) return { error: "balance must be > 0" };
  if (interest !== null && interest < 0) return { error: "interest_rate invalid" };
  if (monthly_payment !== null && monthly_payment < 0) return { error: "monthly_payment invalid" };
  if (!CURRENCIES.includes(currency)) return { error: "invalid currency" };

  // Verify linked asset belongs to user
  if (linked_asset_id) {
    const a = await db.select().from(assets).where(and(eq(assets.id, linked_asset_id), eq(assets.user_id, user.id))).limit(1);
    if (a.length === 0) return { error: "linked asset not found" };
  }

  await db.insert(liabilities).values({
    user_id: user.id,
    name,
    balance: String(balance),
    interest_rate: interest !== null ? String(interest) : null,
    monthly_payment: monthly_payment !== null ? String(monthly_payment) : null,
    currency,
    linked_asset_id,
  });

  revalidatePath("/money-map/liabilities");
  revalidatePath("/money-map/assets");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function updateLiability(id: string, formData: FormData) {
  const user = await requireUser();
  const patch: Record<string, unknown> = { updated_at: new Date() };

  const name = formData.get("name");
  if (name !== null) {
    const s = String(name).trim();
    if (!s) return { error: "name required" };
    patch.name = s;
  }
  const balance = formData.get("balance");
  if (balance !== null) {
    const n = Number(balance);
    if (!Number.isFinite(n) || n <= 0) return { error: "balance must be > 0" };
    patch.balance = String(n);
  }
  const interest = formData.get("interest_rate");
  if (interest !== null) {
    if (interest === "") patch.interest_rate = null;
    else {
      const n = Number(interest);
      if (!Number.isFinite(n) || n < 0) return { error: "rate invalid" };
      patch.interest_rate = String(n);
    }
  }
  const mp = formData.get("monthly_payment");
  if (mp !== null) {
    if (mp === "") patch.monthly_payment = null;
    else {
      const n = Number(mp);
      if (!Number.isFinite(n) || n < 0) return { error: "payment invalid" };
      patch.monthly_payment = String(n);
    }
  }
  const currency = formData.get("currency");
  if (currency !== null) {
    const s = String(currency);
    if (!CURRENCIES.includes(s)) return { error: "invalid currency" };
    patch.currency = s;
  }
  const linked = formData.get("linked_asset_id");
  if (linked !== null) {
    const s = String(linked);
    if (s === "") patch.linked_asset_id = null;
    else {
      const a = await db.select().from(assets).where(and(eq(assets.id, s), eq(assets.user_id, user.id))).limit(1);
      if (a.length === 0) return { error: "linked asset not found" };
      patch.linked_asset_id = s;
    }
  }

  await db.update(liabilities).set(patch).where(and(eq(liabilities.id, id), eq(liabilities.user_id, user.id)));
  revalidatePath("/money-map/liabilities");
  revalidatePath("/money-map/assets");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function deleteLiability(id: string) {
  const user = await requireUser();
  await db
    .delete(liabilities)
    .where(and(eq(liabilities.id, id), eq(liabilities.user_id, user.id)));
  revalidatePath("/money-map/liabilities");
  revalidatePath("/money-map/assets");
  revalidatePath("/money-map");
}
