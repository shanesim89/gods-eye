import "server-only";
import { getScanResult } from "@/lib/crypto/scanner";
import { getLeadersResult, type LeaderRow } from "@/lib/stocks/leaders";
import { getDipResult, type DipRow } from "@/lib/stocks/dip-bounce";
import { stockFieldSource } from "./schema";
import type { Predicate, RankTerm, ScreenSpec } from "./parse";

/**
 * Execute a parsed ScreenSpec against the existing universe pipelines.
 * Reuses the same cached snapshots the scanner / leaders / dip-bounce pages
 * read — no new data fetch. Filters, then ranks by a normalized weighted score.
 */

export type ScreenRow = {
  symbol: string;
  name: string;
  price: number;
  assetClass: "crypto" | "stocks";
  href: string;
  score: number; // 0-100
  metrics: Record<string, number | string | boolean | null>;
};

export type ScreenResult = {
  theme: string;
  assetClass: "crypto" | "stocks";
  generatedAt: string;
  total: number;
  matched: number;
  rationale: string;
  unmet: string[];
  rows: ScreenRow[];
};

const TOP_N = 40;

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as object)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

function passes(row: unknown, p: Predicate): boolean {
  const v = getPath(row, p.field);
  if (v == null) return false; // null data never satisfies a hard filter
  if (p.op === "contains") {
    if (Array.isArray(v)) return v.map(String).includes(String(p.value));
    return String(v) === String(p.value);
  }
  if (p.op === "==") return v === p.value || String(v) === String(p.value);
  const a = typeof v === "number" ? v : Number(v);
  const b = typeof p.value === "number" ? p.value : Number(p.value);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  switch (p.op) {
    case ">": return a > b;
    case ">=": return a >= b;
    case "<": return a < b;
    case "<=": return a <= b;
    default: return false;
  }
}

/** Min-max normalize one numeric field across rows → 0..1, respecting direction. */
function normalized(rows: unknown[], term: RankTerm): number[] {
  const vals = rows.map((r) => {
    const v = getPath(r, term.field);
    return typeof v === "number" ? v : Number(v);
  });
  const finite = vals.filter((x) => Number.isFinite(x));
  if (finite.length === 0) return rows.map(() => 0);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  return vals.map((x) => {
    if (!Number.isFinite(x)) return 0;
    const n = (x - min) / span;
    return term.direction === "asc" ? 1 - n : n;
  });
}

function scoreRows(rows: unknown[], rank: RankTerm[]): number[] {
  if (rank.length === 0) return rows.map(() => 50);
  const totalW = rank.reduce((s, t) => s + (t.weight || 0), 0) || 1;
  const cols = rank.map((t) => ({ t, col: normalized(rows, t) }));
  return rows.map((_, i) => {
    let s = 0;
    for (const { t, col } of cols) s += (t.weight / totalW) * col[i];
    return Math.round(s * 1000) / 10; // 0..100, 1dp
  });
}

function pickMetrics(row: Record<string, unknown>, spec: ScreenSpec): Record<string, number | string | boolean | null> {
  const keys = new Set<string>();
  spec.filters.forEach((f) => keys.add(f.field));
  spec.rank.forEach((r) => keys.add(r.field));
  const out: Record<string, number | string | boolean | null> = {};
  for (const k of keys) {
    const v = getPath(row, k);
    out[k] = (typeof v === "number" || typeof v === "string" || typeof v === "boolean") ? v : null;
  }
  return out;
}

async function cryptoUniverse(): Promise<Record<string, unknown>[]> {
  const scan = await getScanResult();
  return (scan?.coins ?? []) as unknown as Record<string, unknown>[];
}

/** Merge leaders + dip rows by symbol so both field sets are queryable. */
async function stockUniverse(spec: ScreenSpec): Promise<Record<string, unknown>[]> {
  const needsLeaders = [...spec.filters, ...spec.rank].some((t) => stockFieldSource(t.field) === "leaders");
  const needsDip = [...spec.filters, ...spec.rank].some((t) => stockFieldSource(t.field) === "dip");
  // Default to leaders if the spec referenced neither (e.g. empty parse).
  const [ldRes, dipRes] = await Promise.allSettled([
    needsLeaders || (!needsLeaders && !needsDip) ? getLeadersResult() : Promise.resolve(null),
    needsDip ? getDipResult() : Promise.resolve(null),
  ]);
  const leaders = ldRes.status === "fulfilled" ? ldRes.value : null;
  const dip = dipRes.status === "fulfilled" ? dipRes.value : null;

  const bySym = new Map<string, Record<string, unknown>>();
  for (const r of leaders?.rows ?? []) {
    bySym.set(r.symbol, { ...(r as LeaderRow) });
  }
  for (const r of dip?.rows ?? []) {
    const existing = bySym.get(r.symbol);
    if (existing) Object.assign(existing, r as DipRow);
    else bySym.set(r.symbol, { ...(r as DipRow) });
  }
  return [...bySym.values()];
}

export async function runScreen(spec: ScreenSpec): Promise<ScreenResult> {
  const isCrypto = spec.assetClass === "crypto";
  const universe = isCrypto ? await cryptoUniverse() : await stockUniverse(spec);

  const matched = universe.filter((row) => spec.filters.every((p) => passes(row, p)));
  const scores = scoreRows(matched, spec.rank);

  const rows: ScreenRow[] = matched
    .map((row, i) => {
      const symbol = String(row.symbol ?? "").toUpperCase();
      const slug = isCrypto ? symbol : symbol;
      return {
        symbol,
        name: String(row.name ?? symbol),
        price: typeof row.price === "number" ? row.price : 0,
        assetClass: spec.assetClass,
        href: isCrypto ? `/guru/crypto/${slug}` : `/guru/stocks/${slug}`,
        score: scores[i],
        metrics: pickMetrics(row, spec),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  return {
    theme: "",
    assetClass: spec.assetClass,
    generatedAt: new Date().toISOString(),
    total: universe.length,
    matched: matched.length,
    rationale: spec.rationale,
    unmet: spec.unmet,
    rows,
  };
}
