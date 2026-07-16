// One-off: reconstruct the last 30 UTC days into daily_pnl (source='backfill').
// Idempotent — ON CONFLICT (user_id, day, bot) DO UPDATE. The daily cron later
// overwrites overlapping days with authoritative source='snapshot' rows.
//
// Coverage (honest limits): options + crypto reconstruct a full 30d; quant only
// as far as its history[] curve reaches; scalpers only the ~1-2 days their
// recent_trades[] window covers. Older scalper days stay "no data" until the
// cron accumulates real history. Run: node scripts/backfill-daily-pnl.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// --- load .env.local (same parser as backfill-hype.mjs) ---
const env = {};
const envFile = process.argv[2] ?? "../.env.local";
for (const line of readFileSync(new URL(envFile, import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "").replace(/\\n$/, "");
}
if (!env.DATABASE_URL) throw new Error("DATABASE_URL missing in .env.local");

const sql = neon(env.DATABASE_URL);
const USER = "2d4c2a10-39d1-491c-ae39-18d515cd559e";
const coverage = {}; // bot -> Set<day>

async function upsert(day, bot, realized, returnPct, activity, equity) {
  await sql`
    INSERT INTO daily_pnl (user_id, day, bot, realized_pnl, return_pct, activity_count, equity, source)
    VALUES (${USER}, ${day}, ${bot}, ${realized}, ${returnPct}, ${activity}, ${equity}, 'backfill')
    ON CONFLICT (user_id, day, bot) DO UPDATE SET
      realized_pnl = EXCLUDED.realized_pnl,
      return_pct = EXCLUDED.return_pct,
      activity_count = EXCLUDED.activity_count,
      equity = EXCLUDED.equity,
      source = 'backfill'`;
  (coverage[bot] ??= new Set()).add(day);
}

// ── options — real realized P/L by settled_at ────────────────────────────────
const opt = await sql`
  SELECT to_char(date_trunc('day', settled_at), 'YYYY-MM-DD') AS day,
         coalesce(sum(realized_pnl), 0) AS pnl, count(*) AS n
  FROM ai_options_positions
  WHERE user_id = ${USER} AND status != 'open'
        AND settled_at >= now() - interval '30 days'
  GROUP BY 1`;
for (const r of opt) await upsert(r.day, "options", Number(r.pnl).toFixed(2), null, Number(r.n), null);

// ── crypto — order activity (no realized_pnl concept) ────────────────────────
const cry = await sql`
  SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*) AS n
  FROM ai_trade_orders
  WHERE user_id = ${USER} AND created_at >= now() - interval '30 days'
  GROUP BY 1`;
for (const r of cry) await upsert(r.day, "crypto", null, null, Number(r.n), null);

// ── quant — equity delta from history[] ──────────────────────────────────────
const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const [qRow] = await sql`SELECT payload FROM market_data_cache WHERE ticker = 'quant:scrap:state' LIMIT 1`;
const qHist = [...((qRow?.payload?.history) ?? [])].sort((a, b) => a.date.localeCompare(b.date));
for (let i = 0; i < qHist.length; i++) {
  const { date, equity } = qHist[i];
  if (date < cutoff) continue;
  const prev = i > 0 ? qHist[i - 1].equity : equity;
  const delta = equity - prev;
  if (delta === 0) continue; // skip flat filler days
  const pct = prev > 0 ? ((delta / prev) * 100).toFixed(4) : null;
  await upsert(date, "quant", delta.toFixed(2), pct, 0, equity.toFixed(2));
}

// ── scalpers — recent_trades[] bucketed by exit date (~1-2 days only) ─────────
const SCALPERS = [
  ["gold", "gold:scalper:state"],
  ["pdhl", "gold:pdhl:state"],
  ["pdhl4h", "gold:pdhl:4h:state"],
  ["pdhl8h", "gold:pdhl:8h:state"],
];
for (const [bot, key] of SCALPERS) {
  const [row] = await sql`SELECT payload FROM market_data_cache WHERE ticker = ${key} LIMIT 1`;
  const p = row?.payload ?? {};
  const startBal = p.starting_balance ?? 10000;
  const byDay = new Map();
  for (const t of p.recent_trades ?? []) {
    const day = (t.exit ?? "").slice(0, 10);
    if (!day || day < cutoff) continue;
    const cur = byDay.get(day) ?? { pnl: 0, n: 0 };
    cur.pnl += t.pnl ?? 0;
    cur.n += 1;
    byDay.set(day, cur);
  }
  for (const [day, { pnl, n }] of byDay) {
    const pct = startBal > 0 ? ((pnl / startBal) * 100).toFixed(4) : null;
    await upsert(day, bot, pnl.toFixed(2), pct, n, p.equity != null ? Number(p.equity).toFixed(2) : null);
  }
}

// ── coverage summary ─────────────────────────────────────────────────────────
console.log("backfill complete — day coverage per bot:");
for (const bot of ["options", "crypto", "quant", "gold", "pdhl", "pdhl4h", "pdhl8h"]) {
  const days = coverage[bot] ? [...coverage[bot]].sort() : [];
  console.log(`  ${bot.padEnd(8)} ${String(days.length).padStart(2)} days` +
    (days.length ? ` (${days[0]} … ${days[days.length - 1]})` : " (none)"));
}
console.log("note: scalper coverage is intentionally sparse — recent_trades[] only spans ~1-2 days.");
