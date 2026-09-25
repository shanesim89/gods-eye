import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import type { BotKey } from "@/lib/ai-portfolio/registry";

export const BRAIN_BOT_KEYS = ["quant", "options", "vulcan", "universe", "mcscalp_eq"] as const satisfies readonly BotKey[];

export type BrainAmendment = {
  status: string;
  param: string;
  from: string;
  to: string;
  ts: string;
};

export type BrainState = {
  bot: string;
  last_review: { date: string; amendments_proposed: string; review_md: string } | null;
  recent_amendments: BrainAmendment[];
  published_at: string;
};

export async function getBrainStates(): Promise<Partial<Record<BotKey, BrainState>>> {
  const tickers = BRAIN_BOT_KEYS.map((key) => `brain:${key}`);
  const rows = await db
    .select()
    .from(market_data_cache)
    .where(inArray(market_data_cache.ticker, tickers));

  const out: Partial<Record<BotKey, BrainState>> = {};
  for (const row of rows) {
    const key = row.ticker.replace("brain:", "") as BotKey;
    const payload = row.payload as Partial<BrainState> | null;
    if (!payload || typeof payload.bot !== "string" || !Array.isArray(payload.recent_amendments)) continue;
    out[key] = payload as BrainState;
  }
  return out;
}
