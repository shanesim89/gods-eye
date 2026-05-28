"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { assets, liabilities } from "@/db/schema";
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
const CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "MYR", "HKD"];

function parseNum(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function createAsset(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const ticker = String(formData.get("ticker") ?? "").trim().toUpperCase() || null;
  const qty = Number(formData.get("qty"));
  const cost_basis = Number(formData.get("cost_basis"));
  const current_value = parseNum(formData.get("current_value"));
  const currency = String(formData.get("currency") ?? "SGD");
  const asset_class = String(formData.get("asset_class") ?? "");
  const linked_liability_id_raw = String(formData.get("linked_liability_id") ?? "");
  const linked_liability_id = linked_liability_id_raw && linked_liability_id_raw !== "" ? linked_liability_id_raw : null;
  const auto_price_raw = formData.get("auto_price");
  const auto_price = auto_price_raw === null ? true : (auto_price_raw === "true" || auto_price_raw === "on" || auto_price_raw === "1");

  if (!name && !ticker) return { error: "name or ticker required" };
  if (!Number.isFinite(qty) || qty <= 0) return { error: "qty must be > 0" };
  if (!Number.isFinite(cost_basis) || cost_basis < 0) return { error: "cost_basis must be >= 0" };
  if (current_value !== null && current_value < 0) return { error: "current_value invalid" };
  if (!CURRENCIES.includes(currency)) return { error: "invalid currency" };
  if (!ASSET_CLASSES.includes(asset_class as (typeof ASSET_CLASSES)[number]))
    return { error: "invalid asset_class" };

  // Verify linked liability belongs to user (if provided)
  if (linked_liability_id) {
    const l = await db.select().from(liabilities).where(and(eq(liabilities.id, linked_liability_id), eq(liabilities.user_id, user.id))).limit(1);
    if (l.length === 0) return { error: "linked liability not found" };
  }

  const [inserted] = await db.insert(assets).values({
    user_id: user.id,
    name: name || ticker || "untitled",
    ticker,
    qty: String(qty),
    cost_basis: String(cost_basis),
    current_value: current_value !== null ? String(current_value) : null,
    currency,
    asset_class,
    auto_price,
  }).returning({ id: assets.id });

  // Update reverse link on liability
  if (linked_liability_id && inserted) {
    await db.update(liabilities).set({ linked_asset_id: inserted.id, updated_at: new Date() })
      .where(and(eq(liabilities.id, linked_liability_id), eq(liabilities.user_id, user.id)));
  }

  revalidatePath("/money-map/assets");
  revalidatePath("/money-map/liabilities");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function updateAsset(id: string, formData: FormData) {
  const user = await requireUser();
  const patch: Record<string, unknown> = { updated_at: new Date() };

  const name = formData.get("name");
  if (name !== null) {
    const s = String(name).trim();
    if (!s) return { error: "name required" };
    patch.name = s;
  }
  const ticker = formData.get("ticker");
  if (ticker !== null) {
    const s = String(ticker).trim().toUpperCase();
    patch.ticker = s === "" ? null : s;
  }
  const qty = formData.get("qty");
  if (qty !== null) {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) return { error: "qty must be > 0" };
    patch.qty = String(n);
  }
  const cost_basis = formData.get("cost_basis");
  if (cost_basis !== null) {
    const n = Number(cost_basis);
    if (!Number.isFinite(n) || n < 0) return { error: "cost_basis invalid" };
    patch.cost_basis = String(n);
  }
  const cv = formData.get("current_value");
  if (cv !== null) {
    if (cv === "") patch.current_value = null;
    else {
      const n = Number(cv);
      if (!Number.isFinite(n) || n < 0) return { error: "current_value invalid" };
      patch.current_value = String(n);
    }
  }
  const ap = formData.get("auto_price");
  if (ap !== null) {
    patch.auto_price = ap === "true" || ap === "on" || ap === "1";
  }
  const currency = formData.get("currency");
  if (currency !== null) {
    const s = String(currency);
    if (!CURRENCIES.includes(s)) return { error: "invalid currency" };
    patch.currency = s;
  }
  const asset_class = formData.get("asset_class");
  if (asset_class !== null) {
    const s = String(asset_class);
    if (!ASSET_CLASSES.includes(s as (typeof ASSET_CLASSES)[number])) return { error: "invalid asset_class" };
    patch.asset_class = s;
  }
  await db.update(assets).set(patch).where(and(eq(assets.id, id), eq(assets.user_id, user.id)));

  // Handle link change separately (writes to liabilities table)
  const linked = formData.get("linked_liability_id");
  if (linked !== null) {
    const s = String(linked);
    // First clear any existing link pointing to this asset
    await db.update(liabilities).set({ linked_asset_id: null, updated_at: new Date() })
      .where(and(eq(liabilities.linked_asset_id, id), eq(liabilities.user_id, user.id)));
    if (s !== "") {
      const lia = await db.select().from(liabilities).where(and(eq(liabilities.id, s), eq(liabilities.user_id, user.id))).limit(1);
      if (lia.length === 0) return { error: "linked liability not found" };
      await db.update(liabilities).set({ linked_asset_id: id, updated_at: new Date() })
        .where(and(eq(liabilities.id, s), eq(liabilities.user_id, user.id)));
    }
  }

  revalidatePath("/money-map/assets");
  revalidatePath("/money-map/liabilities");
  revalidatePath("/money-map");
  return { ok: true };
}

export async function deleteAsset(id: string) {
  const user = await requireUser();
  // Clear reverse links
  await db.update(liabilities).set({ linked_asset_id: null, updated_at: new Date() })
    .where(and(eq(liabilities.linked_asset_id, id), eq(liabilities.user_id, user.id)));
  await db.delete(assets).where(and(eq(assets.id, id), eq(assets.user_id, user.id)));
  revalidatePath("/money-map/assets");
  revalidatePath("/money-map/liabilities");
  revalidatePath("/money-map");
}
