import "server-only";
import { db } from "@/db/client";
import { market_data_cache, scanner_history } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";

/**
 * Crypto Moonshot Scanner — scans the top-1000 CoinGecko universe and ranks
 * coins by probability of a large upside move. Two ranking modes share the
 * same four signal dimensions with different weights:
 *
 *  - Momentum ignition: volume precedes price; vol/mcap normalizes volume
 *    across cap sizes, and 24h-vs-7d pace acceleration catches the inflection
 *    point rather than the exhausted top.
 *  - Upside runway: a coin down 95% from a proven ATH needs 20x just to
 *    reclaim it. Scored high only when turning (7d > 0 or 24h > 5) so the
 *    bucket isn't a graveyard of dead coins.
 *  - Stealth accumulation: rising volume while price stays flat (Wyckoff
 *    accumulation) in the rank 300–1000 band where 50x math is possible.
 *  - Liquidity quality: 50x is arithmetic — impossible above ~$5B mcap,
 *    manipulation zone below ~$2M. Sweet spot $10M–$500M.
 *
 * A late-pump penalty (7d > +50%) discounts coins that already ran, and a
 * LunarCrush social-surge bonus is layered on finalists when a key is set.
 */

const CG_KEY = process.env.COINGECKO_API_KEY;
const CG_BASE = "https://api.coingecko.com/api/v3";
const LC_KEY = process.env.LUNARCRUSH_API_KEY;

export const SCANNER_CACHE_KEY = "scanner:v1";

export type RugFlag = "WASH?" | "MICRO" | "WILD" | "THIN";
export type Bucket = "MOONSHOT" | "BREAKOUT" | "STEALTH" | "SOCIAL";
export type RiskTier = "speculative" | "high" | "medium" | "low";

export type ScoredCoin = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  price: number;
  mcap: number;
  rank: number;
  vol24h: number;
  volMcap: number;
  pct1h: number | null;
  pct24h: number | null;
  pct7d: number | null;
  pct30d: number | null;
  athChangePct: number;
  upsideMultiple: number;
  scoreScalp: number;
  scoreMoonshot: number;
  dims: { momentum: number; runway: number; stealth: number; liquidity: number };
  buckets: Bucket[];
  rugFlags: RugFlag[];
  socialSurge: boolean;
  galaxyScore: number | null;
  riskTier: RiskTier;
};

export type ScanResult = {
  generatedAt: string;
  universe: number;
  passed: number;
  coins: ScoredCoin[];
};

type CgMarket = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  total_volume: number | null;
  ath: number | null;
  ath_change_percentage: number | null;
  price_change_percentage_1h_in_currency?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
  sparkline_in_7d?: { price?: number[] };
};

const STABLE_SYMBOLS = new Set([
  "usdt", "usdc", "dai", "busd", "tusd", "usdd", "usde", "fdusd", "pyusd",
  "usdp", "gusd", "frax", "lusd", "susd", "eurc", "eurt", "usd0", "usds",
  "usdy", "usdl", "rlusd", "usd1", "gho", "crvusd", "mim", "dola", "bold",
]);

const WRAPPED_RE =
  /wrapped|staked|restaked|bridged|wormhole|binance-peg|-peg-|liquid staking|^w(btc|eth|bnb|sol|avax|matic|steth)/i;

const WRAPPED_SYMBOLS = new Set([
  "wbtc", "weth", "wbnb", "wsteth", "steth", "reth", "cbeth", "cbbtc",
  "meth", "ezeth", "rseth", "weeth", "jitosol", "msol", "bnsol", "jupsol",
  "tbtc", "lbtc", "solvbtc", "wbeth", "oseth", "sweth", "lseth", "frxeth",
  "sfrxeth", "stsol", "ankreth",
]);

function isStablecoin(c: CgMarket): boolean {
  if (STABLE_SYMBOLS.has(c.symbol.toLowerCase())) return true;
  const p = c.current_price ?? 0;
  const d24 = Math.abs(c.price_change_percentage_24h_in_currency ?? 0);
  const d7 = Math.abs(c.price_change_percentage_7d_in_currency ?? 0);
  return p > 0.97 && p < 1.03 && d24 < 1 && d7 < 2;
}

function isWrappedOrStaked(c: CgMarket): boolean {
  if (WRAPPED_SYMBOLS.has(c.symbol.toLowerCase())) return true;
  return WRAPPED_RE.test(c.name) || WRAPPED_RE.test(c.id);
}

async function fetchUniverse(): Promise<CgMarket[]> {
  const headers: Record<string, string> = CG_KEY ? { "x-cg-demo-api-key": CG_KEY } : {};
  const all: CgMarket[] = [];
  for (let page = 1; page <= 8; page++) {
    try {
      const r = await fetch(
        `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=true&price_change_percentage=1h,24h,7d,30d`,
        { headers, cache: "no-store" }
      );
      if (!r.ok) {
        console.error(`[scanner] CoinGecko page ${page} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        continue;
      }
      const data = (await r.json()) as CgMarket[];
      if (Array.isArray(data)) all.push(...data);
    } catch (err) {
      // skip failed page — partial universe is still usable
      console.error(`[scanner] CoinGecko page ${page} fetch failed:`, err instanceof Error ? err.message : err);
    }
    // Throttle every page (demo key ~30 req/min). Skipping the delay on pages
    // 4–8 was triggering 429s → silently dropped ranks ~750-2000, the exact
    // moonshot/stealth band the scanner targets.
    if (page < 8) await new Promise((res) => setTimeout(res, 400));
  }
  // Dedupe by id (pagination can shift between requests)
  const seen = new Set<string>();
  return all.filter((c) => {
    if (!c?.id || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

function passesFilters(c: CgMarket): boolean {
  const mcap = c.market_cap ?? 0;
  const vol = c.total_volume ?? 0;
  const price = c.current_price ?? 0;
  if (price <= 0 || mcap < 2_000_000 || vol < 500_000) return false;
  if (vol / mcap > 5) return false; // fake/wash volume
  if (isStablecoin(c) || isWrappedOrStaked(c)) return false;
  return true;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** vol/mcap sweet spot: healthy turnover 0.1–1.0; below = no interest, above = suspect */
function volRatioScore(volMcap: number): number {
  if (volMcap < 0.02) return 0.1;
  if (volMcap < 0.05) return 0.3;
  if (volMcap < 0.1) return 0.6;
  if (volMcap <= 1.0) return 1.0;
  if (volMcap <= 2.0) return 0.7;
  return 0.3;
}

function momentumScore(c: CgMarket, volMcap: number): number {
  const pct1h = c.price_change_percentage_1h_in_currency ?? 0;
  const pct24h = c.price_change_percentage_24h_in_currency ?? 0;
  const pct7d = c.price_change_percentage_7d_in_currency ?? 0;
  // Acceleration: is the last 24h moving faster than the 7d daily pace?
  const accel = pct24h - pct7d / 7;
  const accelScore = clamp01((accel + 5) / 25);
  const dirScore = pct1h > 0 && pct24h > 0 ? 1 : pct24h > 0 ? 0.5 : 0;
  return clamp01(volRatioScore(volMcap) * 0.45 + accelScore * 0.4 + dirScore * 0.15);
}

function runwayScore(c: CgMarket): number {
  const drawdown = -(c.ath_change_percentage ?? 0); // 95 = down 95% from ATH
  let depth: number;
  if (drawdown < 50) depth = 0.1;
  else if (drawdown < 80) depth = 0.1 + ((drawdown - 50) / 30) * 0.6;
  else if (drawdown <= 97) depth = 0.7 + ((drawdown - 80) / 17) * 0.3;
  else depth = 0.5; // >97% down — likely dead or rugged, discount
  const pct24h = c.price_change_percentage_24h_in_currency ?? 0;
  const pct7d = c.price_change_percentage_7d_in_currency ?? 0;
  const turning = pct7d > 0 || pct24h > 5;
  return clamp01(turning ? depth : depth * 0.15);
}

function stealthScore(c: CgMarket, volMcap: number): number {
  const rank = c.market_cap_rank ?? 9999;
  const rankScore = rank >= 300 && rank <= 1000 ? 1 : rank >= 150 ? 0.5 : 0;
  const pct7d = c.price_change_percentage_7d_in_currency ?? 0;
  const flatScore = clamp01(1 - Math.abs(pct7d) / 10);
  const volPresence = volMcap >= 0.05 ? clamp01(volMcap / 0.3) : (volMcap / 0.05) * 0.3;
  // Sparkline quietness: tight 7d price range + volume present = accumulation
  let rangeScore = 0.5;
  const spark = c.sparkline_in_7d?.price;
  if (spark && spark.length > 10) {
    const valid = spark.filter((p) => Number.isFinite(p) && p > 0);
    if (valid.length > 10) {
      const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
      const range = (Math.max(...valid) - Math.min(...valid)) / avg;
      rangeScore = range < 0.15 ? 1 : range < 0.3 ? 0.6 : 0.3;
    }
  }
  return clamp01(rankScore * 0.35 + flatScore * 0.25 + volPresence * 0.25 + rangeScore * 0.15);
}

function liquidityScore(c: CgMarket): number {
  const mcap = c.market_cap ?? 0;
  const vol = c.total_volume ?? 0;
  let band: number;
  if (mcap < 10_000_000) band = 0.5;
  else if (mcap < 500_000_000) band = 1.0;
  else if (mcap < 2_000_000_000) band = 0.6;
  else if (mcap < 5_000_000_000) band = 0.3;
  else band = 0.1;
  return clamp01(band * 0.7 + clamp01(vol / 5_000_000) * 0.3);
}

const WEIGHTS = {
  scalp: { momentum: 0.5, runway: 0.15, stealth: 0.15, liquidity: 0.2 },
  moonshot: { momentum: 0.2, runway: 0.35, stealth: 0.3, liquidity: 0.15 },
};

/** Coins already up >50% in 7d get discounted (down to ×0.6 at +150%) — late entry risk */
function latePumpFactor(pct7d: number | null): number {
  const p = pct7d ?? 0;
  if (p <= 50) return 1;
  return Math.max(0.6, 1 - (p - 50) / 250);
}

function rugFlags(c: CgMarket, volMcap: number): RugFlag[] {
  const flags: RugFlag[] = [];
  if (volMcap > 3) flags.push("WASH?");
  if ((c.market_cap ?? 0) < 10_000_000) flags.push("MICRO");
  if (Math.abs(c.price_change_percentage_24h_in_currency ?? 0) > 40) flags.push("WILD");
  if ((c.total_volume ?? 0) < 1_000_000) flags.push("THIN");
  return flags;
}

function riskTier(mcap: number): RiskTier {
  if (mcap < 10_000_000) return "speculative";
  if (mcap < 100_000_000) return "high";
  if (mcap < 1_000_000_000) return "medium";
  return "low";
}

function scoreCoin(c: CgMarket): ScoredCoin {
  const mcap = c.market_cap ?? 0;
  const vol = c.total_volume ?? 0;
  const volMcap = mcap > 0 ? vol / mcap : 0;
  const dims = {
    momentum: momentumScore(c, volMcap),
    runway: runwayScore(c),
    stealth: stealthScore(c, volMcap),
    liquidity: liquidityScore(c),
  };
  const penalty = latePumpFactor(c.price_change_percentage_7d_in_currency ?? null);
  const weigh = (w: typeof WEIGHTS.scalp) =>
    Math.round(
      (dims.momentum * w.momentum +
        dims.runway * w.runway +
        dims.stealth * w.stealth +
        dims.liquidity * w.liquidity) *
        100 *
        penalty
    );

  const buckets: Bucket[] = [];
  if (dims.runway >= 0.6) buckets.push("MOONSHOT");
  if (dims.momentum >= 0.6) buckets.push("BREAKOUT");
  if (dims.stealth >= 0.6) buckets.push("STEALTH");

  const price = c.current_price ?? 0;
  const ath = c.ath ?? 0;
  return {
    id: c.id,
    symbol: c.symbol.toUpperCase(),
    name: c.name,
    image: c.image,
    price,
    mcap,
    rank: c.market_cap_rank ?? 0,
    vol24h: vol,
    volMcap: Number(volMcap.toFixed(3)),
    pct1h: c.price_change_percentage_1h_in_currency ?? null,
    pct24h: c.price_change_percentage_24h_in_currency ?? null,
    pct7d: c.price_change_percentage_7d_in_currency ?? null,
    pct30d: c.price_change_percentage_30d_in_currency ?? null,
    athChangePct: c.ath_change_percentage ?? 0,
    upsideMultiple: price > 0 && ath > price ? Math.min(100, Number((ath / price).toFixed(1))) : 1,
    scoreScalp: weigh(WEIGHTS.scalp),
    scoreMoonshot: weigh(WEIGHTS.moonshot),
    dims: {
      momentum: Number(dims.momentum.toFixed(2)),
      runway: Number(dims.runway.toFixed(2)),
      stealth: Number(dims.stealth.toFixed(2)),
      liquidity: Number(dims.liquidity.toFixed(2)),
    },
    buckets,
    rugFlags: rugFlags(c, volMcap),
    socialSurge: false,
    galaxyScore: null,
    riskTier: riskTier(mcap),
  };
}

type LcCoin = { symbol?: string; galaxy_score?: number };

/**
 * LunarCrush social overlay — one list call, matched by symbol. Galaxy score
 * >= 70 marks a social surge (+10 bonus); >= 60 gets +5. Silently skipped
 * when no API key is configured.
 */
async function enrichSocial(coins: ScoredCoin[]): Promise<void> {
  if (!LC_KEY) return;
  try {
    const r = await fetch("https://lunarcrush.com/api4/public/coins/list/v1", {
      headers: { Authorization: `Bearer ${LC_KEY}` },
      cache: "no-store",
    });
    if (!r.ok) return;
    const j = (await r.json()) as { data?: LcCoin[] };
    if (!Array.isArray(j.data)) return;
    const bySymbol = new Map<string, LcCoin>();
    for (const lc of j.data) {
      const sym = lc.symbol?.toUpperCase();
      if (sym && !bySymbol.has(sym)) bySymbol.set(sym, lc);
    }
    for (const coin of coins) {
      const lc = bySymbol.get(coin.symbol);
      const gs = typeof lc?.galaxy_score === "number" ? lc.galaxy_score : null;
      if (gs === null) continue;
      coin.galaxyScore = gs;
      const bonus = gs >= 70 ? 10 : gs >= 60 ? 5 : 0;
      if (bonus > 0) {
        coin.scoreScalp = Math.min(100, coin.scoreScalp + bonus);
        coin.scoreMoonshot = Math.min(100, coin.scoreMoonshot + bonus);
      }
      if (gs >= 70) {
        coin.socialSurge = true;
        if (!coin.buckets.includes("SOCIAL")) coin.buckets.push("SOCIAL");
      }
    }
  } catch {
    // social layer is a bonus — never fail the scan over it
  }
}

export async function runScan(): Promise<ScanResult> {
  const universe = await fetchUniverse();
  const filtered = universe.filter(passesFilters);
  const scored = filtered.map(scoreCoin);
  scored.sort(
    (a, b) =>
      Math.max(b.scoreScalp, b.scoreMoonshot) - Math.max(a.scoreScalp, a.scoreMoonshot)
  );
  const top = scored.slice(0, 150);
  await enrichSocial(top);
  return {
    generatedAt: new Date().toISOString(),
    universe: universe.length,
    passed: filtered.length,
    coins: top,
  };
}

export async function writeScanCache(result: ScanResult): Promise<void> {
  await db
    .insert(market_data_cache)
    .values({ ticker: SCANNER_CACHE_KEY, payload: result, fetched_at: new Date() })
    .onConflictDoUpdate({
      target: market_data_cache.ticker,
      set: { payload: result, fetched_at: new Date() },
    });
}

export async function readScanCache(): Promise<ScanResult | null> {
  const r = await db
    .select()
    .from(market_data_cache)
    .where(eq(market_data_cache.ticker, SCANNER_CACHE_KEY))
    .limit(1);
  if (r.length === 0) return null;
  const p = r[0].payload as ScanResult;
  return Array.isArray(p?.coins) ? p : null;
}

export async function writeHistory(result: ScanResult): Promise<void> {
  if (result.coins.length === 0) return;
  const date = result.generatedAt.slice(0, 10); // "YYYY-MM-DD"
  const byMoonshot = [...result.coins].sort((a, b) => b.scoreMoonshot - a.scoreMoonshot);
  const byScalp = [...result.coins].sort((a, b) => b.scoreScalp - a.scoreScalp);
  const moonshotRank = new Map(byMoonshot.map((c, i) => [c.id, i + 1]));
  const scalpRank = new Map(byScalp.map((c, i) => [c.id, i + 1]));

  const rows = result.coins.map((c) => ({
    scanned_date: date,
    coin_id: c.id,
    symbol: c.symbol,
    name: c.name,
    score_moonshot: c.scoreMoonshot,
    score_scalp: c.scoreScalp,
    rank_moonshot: moonshotRank.get(c.id) ?? 0,
    rank_scalp: scalpRank.get(c.id) ?? 0,
    price: String(c.price),
    mcap: String(c.mcap),
    dims: { ...c.dims, buckets: c.buckets },
  }));

  // Batch upsert — skip if today's rows already exist (cron runs once/day)
  await db
    .insert(scanner_history)
    .values(rows)
    .onConflictDoNothing();
}

export type ScoreHistoryPoint = {
  date: string;
  scoreMoonshot: number;
  scoreScalp: number;
  rankMoonshot: number;
  rankScalp: number;
  price: number;
};

export async function getScoreHistory(
  symbol: string,
  days = 30
): Promise<ScoreHistoryPoint[]> {
  const rows = await db
    .select({
      scanned_date: scanner_history.scanned_date,
      score_moonshot: scanner_history.score_moonshot,
      score_scalp: scanner_history.score_scalp,
      rank_moonshot: scanner_history.rank_moonshot,
      rank_scalp: scanner_history.rank_scalp,
      price: scanner_history.price,
    })
    .from(scanner_history)
    .where(eq(scanner_history.symbol, symbol.toUpperCase()))
    .orderBy(desc(scanner_history.scanned_date))
    .limit(days);

  return rows.map((r) => ({
    date: r.scanned_date,
    scoreMoonshot: r.score_moonshot,
    scoreScalp: r.score_scalp,
    rankMoonshot: r.rank_moonshot,
    rankScalp: r.rank_scalp,
    price: Number(r.price),
  }));
}

export type TrendSnapshot = Record<
  string,
  {
    scoreMoonshot: number;
    scoreScalp: number;
    rankMoonshot?: number;
    rankScalp?: number;
    buckets?: Bucket[];
  }
>;

export async function getYesterdaySnapshot(): Promise<TrendSnapshot> {
  const today = new Date().toISOString().slice(0, 10);
  const latest = await db
    .select({ scanned_date: scanner_history.scanned_date })
    .from(scanner_history)
    .where(sql`${scanner_history.scanned_date} < ${today}`)
    .orderBy(desc(scanner_history.scanned_date))
    .limit(1);
  if (!latest.length) return {};
  const prevDate = latest[0].scanned_date;
  const rows = await db
    .select({
      coin_id: scanner_history.coin_id,
      score_moonshot: scanner_history.score_moonshot,
      score_scalp: scanner_history.score_scalp,
      rank_moonshot: scanner_history.rank_moonshot,
      rank_scalp: scanner_history.rank_scalp,
      dims: scanner_history.dims,
    })
    .from(scanner_history)
    .where(eq(scanner_history.scanned_date, prevDate));
  return Object.fromEntries(
    rows.map((r) => {
      const dims = r.dims as { buckets?: Bucket[] } | null;
      return [
        r.coin_id,
        {
          scoreMoonshot: r.score_moonshot,
          scoreScalp: r.score_scalp,
          rankMoonshot: r.rank_moonshot,
          rankScalp: r.rank_scalp,
          buckets: Array.isArray(dims?.buckets) ? dims.buckets : undefined,
        },
      ];
    })
  );
}

/** Serve cached scan; run fresh when missing, or when forced and cache >10 min old. */
export async function getScanResult(force = false): Promise<ScanResult> {
  const cached = await readScanCache();
  if (cached) {
    const age = Date.now() - new Date(cached.generatedAt).getTime();
    if (!force || age < 10 * 60 * 1000) return cached;
  }
  const fresh = await runScan();
  // Never cache an empty scan — it would mask a CoinGecko outage until the next refresh
  if (fresh.coins.length === 0) return cached ?? fresh;
  await writeScanCache(fresh);
  await writeHistory(fresh);
  return fresh;
}
