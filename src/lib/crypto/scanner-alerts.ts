import "server-only";
import { db } from "@/db/client";
import { market_data_cache } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ScanResult, TrendSnapshot } from "./scanner";
import { sendTelegram } from "@/lib/telegram";

/**
 * Scanner → Telegram alert layer. Runs after the daily cron writes history:
 * compares today's scan against yesterday's snapshot and pushes a digest of
 * notable changes. Designed to never fail the cron — every external call is
 * wrapped, and a sentinel row guards against double-sends on re-invocation.
 */

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const ALERT_SENTINEL_KEY = "scanner:alerts:last";

export type ScannerAlert = { coinId: string; line: string };

/** Daily top-N coins by raw upside multiple — the always-on digest header. */
export function topUpside(today: ScanResult, n = 5): string[] {
  return [...today.coins]
    .sort((a, b) => b.upsideMultiple - a.upsideMultiple)
    .slice(0, n)
    .map(
      (c, i) =>
        `${i + 1}. 🌙 ${c.symbol} — ${c.upsideMultiple.toFixed(1)}× upside · score ${c.scoreMoonshot} · ${c.riskTier.toUpperCase()}`
    );
}

export function detectAlerts(today: ScanResult, yesterday: TrendSnapshot): ScannerAlert[] {
  const alerts: ScannerAlert[] = [];
  const byMoonshot = [...today.coins].sort((a, b) => b.scoreMoonshot - a.scoreMoonshot);
  const moonshotRank = new Map(byMoonshot.map((c, i) => [c.id, i + 1]));

  for (const c of today.coins) {
    const prev = yesterday[c.id];
    if (!prev) continue; // new entrant — no baseline, skip (avoids first-day spam)

    const score = Math.max(c.scoreMoonshot, c.scoreScalp);
    const prevScore = Math.max(prev.scoreMoonshot, prev.scoreScalp);
    if (score >= 80 && prevScore < 80) {
      alerts.push({
        coinId: c.id,
        line: `🚀 ${c.symbol} crossed 80 — score ${score} (was ${prevScore}) · ${c.upsideMultiple.toFixed(1)}× upside · ${c.riskTier.toUpperCase()}`,
      });
    }

    if (prev.buckets) {
      for (const tag of ["MOONSHOT", "SOCIAL"] as const) {
        if (c.buckets.includes(tag) && !prev.buckets.includes(tag)) {
          alerts.push({
            coinId: c.id,
            line: `${tag === "MOONSHOT" ? "◆" : "▲"} ${c.symbol} new ${tag} tag — score ${score} · 7d ${c.pct7d?.toFixed(1) ?? "—"}%`,
          });
        }
      }
    }

    const rank = moonshotRank.get(c.id);
    if (rank !== undefined && prev.rankMoonshot !== undefined) {
      const jump = prev.rankMoonshot - rank;
      if (jump > 20) {
        alerts.push({
          coinId: c.id,
          line: `📈 ${c.symbol} jumped ${jump} places to #${rank} (moonshot) — score ${c.scoreMoonshot}`,
        });
      }
    }
  }
  return alerts;
}

/** True when alerts were already sent for this date (cron re-invocation guard). */
async function alreadySentToday(date: string): Promise<boolean> {
  const r = await db
    .select()
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, ALERT_SENTINEL_KEY))
    .limit(1);
  const p = r[0]?.payload as { date?: string } | undefined;
  return p?.date === date;
}

async function markSent(date: string): Promise<void> {
  await db
    .insert(market_data_cache)
    .values({ ticker: ALERT_SENTINEL_KEY, payload: { date }, fetched_at: new Date() })
    .onConflictDoUpdate({
      target: market_data_cache.ticker,
      set: { payload: { date }, fetched_at: new Date() },
    });
}


/**
 * Detect + send the daily alert digest. Returns the number of alerts sent
 * (0 when nothing notable, no config, or already sent today).
 */
export async function runScannerAlerts(
  today: ScanResult,
  yesterday: TrendSnapshot
): Promise<number> {
  if (!TG_TOKEN || !TG_CHAT) return 0;
  const date = today.generatedAt.slice(0, 10);
  try {
    if (await alreadySentToday(date)) return 0;
    const alerts = detectAlerts(today, yesterday);

    // Always-on top-5 upside digest, then any change-signals beneath it.
    const top5 = topUpside(today, 5);
    const header = `🛰 GODS-EYE SCANNER — ${date}\n\n🏆 TOP 5 UPSIDE\n${top5.join("\n")}\n`;
    const lines = alerts.length
      ? [
          "",
          `📡 ${alerts.length} signal${alerts.length > 1 ? "s" : ""}:`,
          "",
          ...alerts.map((a) => a.line),
        ]
      : [];
    // Telegram hard limit 4096 chars per message — chunk conservatively
    let chunk = header;
    let sent = true;
    for (const line of lines) {
      if (chunk.length + line.length + 1 > 3900) {
        sent = (await sendTelegram(chunk)) && sent;
        chunk = "";
      }
      chunk += line + "\n";
    }
    if (chunk.trim()) sent = (await sendTelegram(chunk)) && sent;
    if (sent) await markSent(date);
    return alerts.length;
  } catch (err) {
    console.error("[scanner-alerts] failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}
