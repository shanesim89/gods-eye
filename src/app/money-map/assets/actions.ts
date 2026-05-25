"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { assets } from "@/db/schema";
import { requireUser } from "@/lib/auth";

const ASSET_CLASSES = [
  "cash",
  "equity",
  "etf",
  "crypto",
  "bond",
  "real_estate",
  "commodity",
  "other",
] as const;
const CURRENCIES = ["USD", "SGD", "EUR", "GBP", "JPY", "CNY", "AUD"];

export async function createAsset(formData: FormData) {
  const user = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  const ticker = String(formData.get("ticker") ?? "").trim().toUpperCase() || null;
  const qty = String(formData.get("qty") ?? "");
  const cost_basis = String(formData.get("cost_basis") ?? "");
  const currency = String(formData.get("currency") ?? "USD");
  const asset_class = String(formData.get("asset_class") ?? "");

  if (!name && !ticker) return { error: "name or ticker required" };
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return { error: "qty must be > 0" };
  const cb = Number(cost_basis);
  if (!Number.isFinite(cb) || cb < 0) return { error: "cost_basis must be >= 0" };
  if (!CURRENCIES.includes(currency)) return { error: "invalid currency" };
  if (!ASSET_CLASSES.includes(asset_class as (typeof ASSET_CLASSES)[number]))
    return { error: "invalid asset_class" };

  await db.insert(assets).values({
    user_id: user.id,
    name: name || ticker || "untitled",
    ticker,
    qty: String(q),
    cost_basis: String(cb),
    currency,
    asset_class,
  });

  revalidatePath("/money-map/assets");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function deleteAsset(id: string) {
  const user = await requireUser();
  await db
    .delete(assets)
    .where(and(eq(assets.id, id), eq(assets.user_id, user.id)));
  revalidatePath("/money-map/assets");
  revalidatePath("/money-map");
}
