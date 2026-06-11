import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { council_verdict_cache } from "@/db/schema";
import { buildContext } from "./context";
import { getRoles, runAgent, runPeerReview } from "./agents";
import { synthesizeVerdict } from "./synthesize";
import type { AssetClass, Verdict } from "./types";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — matches the SSE route

// In-process council run with the same 1h cache the SSE route uses.
// Used by the DCA cron and the AI-portfolio dashboard (no HTTP self-call).
export async function runCouncil(
  userId: string,
  assetClass: AssetClass,
  ticker: string,
  opts: { useCache?: boolean } = {}
): Promise<Verdict> {
  const symbol = ticker.toUpperCase().trim();
  const useCache = opts.useCache ?? true;

  if (useCache) {
    const cutoff = new Date(Date.now() - CACHE_TTL_MS);
    const cached = await db
      .select()
      .from(council_verdict_cache)
      .where(
        and(
          eq(council_verdict_cache.user_id, userId),
          eq(council_verdict_cache.ticker, symbol),
          eq(council_verdict_cache.asset_class, assetClass),
          gte(council_verdict_cache.fetched_at, cutoff)
        )
      )
      .orderBy(desc(council_verdict_cache.fetched_at))
      .limit(1);
    if (cached.length > 0) {
      const row = cached[0];
      const p = row.payload as Partial<Verdict>;
      return {
        verdict: row.verdict as Verdict["verdict"],
        confidence: row.confidence ?? 50,
        summary: p.summary ?? "",
        agents: p.agents ?? [],
        generatedAt: row.fetched_at.toISOString(),
        tradeLevels: p.tradeLevels ?? null,
        currency: p.currency ?? "USD",
        laymanExplanation: p.laymanExplanation ?? null,
        aggregateRankings: p.aggregateRankings ?? undefined,
      };
    }
  }

  const ctx = await buildContext(assetClass, symbol);
  const anthropic = new Anthropic();
  const roles = getRoles(assetClass);
  const agentResults = await Promise.all(roles.map((role) => runAgent(role, ctx, anthropic)));
  const { aggregateRankings } = await runPeerReview(agentResults, anthropic);
  const verdict = await synthesizeVerdict(agentResults, ctx, anthropic, aggregateRankings);

  await db.insert(council_verdict_cache).values({
    user_id: userId,
    ticker: symbol,
    asset_class: assetClass,
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    payload: {
      summary: verdict.summary,
      agents: verdict.agents,
      tradeLevels: verdict.tradeLevels,
      currency: verdict.currency,
      laymanExplanation: verdict.laymanExplanation,
      aggregateRankings: verdict.aggregateRankings ?? null,
    } as Record<string, unknown>,
    fetched_at: new Date(),
  });

  return verdict;
}
