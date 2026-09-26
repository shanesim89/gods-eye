// Firecrawl REST v2 client — deliberately SDK-free so per-call timeouts stay
// explicit. Default call: 15s AbortController; whole gather phase: 22s deadline.
import "server-only";

import { FIXED_SCRAPES, FUND_SCRAPES, buildSearchQueries } from "./sources";
import type { OutlookStreamEventV2, ReportFilters, ScrapedSource } from "./types";

const FC_BASE = "https://api.firecrawl.dev/v2";
const CALL_TIMEOUT_MS = 15_000;
// Fund dealer pages (FSMOne/Great Eastern) render distribution figures via
// client-side JS — confirmed empirically that they need waitForMs (~6-8s) to
// appear in the scrape, so those calls get a longer timeout budget.
const FUND_CALL_TIMEOUT_MS = 20_000;
const PHASE_DEADLINE_MS = 22_000;
// 5000 clipped FSSA's "Annualised Returns" section (needed for quarter price
// movement) right at its start — confirmed it lands ~5350 chars in. 7000
// gives real margin for all 4 fund pages without meaningfully growing the
// prompt sent to Claude for the (smaller) commentary/search sources.
const MAX_MARKDOWN_CHARS = 7_000;

class FirecrawlAuthError extends Error {}

async function fcFetch(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = CALL_TIMEOUT_MS
): Promise<Record<string, unknown>> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new FirecrawlAuthError("FIRECRAWL_API_KEY not set");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${FC_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new FirecrawlAuthError(`Firecrawl rejected the API key (HTTP ${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`Firecrawl ${path} failed (HTTP ${res.status})`);
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

// Strips inline base64 image data URIs (logos, chart SVGs) — pure noise that
// can run tens of thousands of characters and, left in, pushes real content
// (e.g. FSMOne's "Dividend Yield (%)" figure) past the truncation cutoff
// before it's ever seen.
function stripDataUris(md: string): string {
  return md.replace(/!\[[^\]]*\]\(data:[^)]*\)/g, "").replace(/\(data:[a-z0-9/+;=,%A-Za-z-]{200,}\)/g, "()");
}

function truncate(md: string): string {
  const cleaned = stripDataUris(md);
  return cleaned.length > MAX_MARKDOWN_CHARS ? cleaned.slice(0, MAX_MARKDOWN_CHARS) + "\n…[truncated]" : cleaned;
}

export async function scrapeUrl(name: string, url: string, waitForMs = 0): Promise<ScrapedSource> {
  const timeoutMs = waitForMs > 0 ? FUND_CALL_TIMEOUT_MS : CALL_TIMEOUT_MS;
  const json = await fcFetch(
    "/scrape",
    {
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      maxAge: 3_600_000, // serve Firecrawl cache if <1h old — fast + cheap retries
      timeout: timeoutMs,
      ...(waitForMs > 0 ? { waitFor: waitForMs } : {}),
    },
    timeoutMs
  );
  const data = json.data as { markdown?: string } | undefined;
  const markdown = data?.markdown?.trim();
  if (!markdown) throw new Error(`no content from ${url}`);
  return { name, url, ok: true, markdown: truncate(markdown) };
}

export async function searchNews(name: string, query: string): Promise<ScrapedSource> {
  const json = await fcFetch("/search", {
    query,
    limit: 3,
    scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
  });
  const data = json.data as
    | { web?: { url?: string; title?: string; markdown?: string }[] }
    | { url?: string; title?: string; markdown?: string }[]
    | undefined;
  const results = Array.isArray(data) ? data : data?.web ?? [];
  const chunks = results
    .filter((r) => r.markdown)
    .map((r) => `### ${r.title ?? r.url}\n${r.markdown!.trim()}`);
  if (chunks.length === 0) throw new Error(`no search results for "${query}"`);
  return { name, url: `search:${query}`, ok: true, markdown: truncate(chunks.join("\n\n")) };
}

/** Gather all sources in parallel (fixed scrapes + PIMCO/AllianzGI fund pages +
 *  search queries). Emits source_done per settle. Never throws on individual
 *  failures — the route decides whether enough succeeded. Throws only on
 *  missing/rejected API key (fail fast, before wasting the Claude budget). */
export async function gatherSourcesV2(
  filters: ReportFilters,
  emit: (e: OutlookStreamEventV2) => void
): Promise<ScrapedSource[]> {
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new FirecrawlAuthError("Firecrawl API key missing — add FIRECRAWL_API_KEY to env config.");
  }

  const jobs: { name: string; run: () => Promise<ScrapedSource> }[] = [
    ...FIXED_SCRAPES.map((s) => ({ name: s.name, run: () => scrapeUrl(s.name, s.url) })),
    ...FUND_SCRAPES.map((s) => ({ name: s.name, run: () => scrapeUrl(s.name, s.url, s.waitForMs ?? 0) })),
    ...buildSearchQueries(filters).map((q) => ({
      name: q.name,
      run: () => searchNews(q.name, q.query),
    })),
  ];

  let authError: FirecrawlAuthError | null = null;
  const results: ScrapedSource[] = [];

  const all = Promise.allSettled(
    jobs.map(async (j) => {
      try {
        const src = await j.run();
        results.push(src);
        emit({ type: "source_done", name: j.name, ok: true });
      } catch (err) {
        if (err instanceof FirecrawlAuthError) authError = err;
        results.push({ name: j.name, url: "", ok: false });
        emit({ type: "source_done", name: j.name, ok: false });
      }
    })
  );

  await Promise.race([
    all,
    new Promise<void>((resolve) => setTimeout(resolve, PHASE_DEADLINE_MS)),
  ]);

  if (authError) throw authError;
  return [...results];
}
