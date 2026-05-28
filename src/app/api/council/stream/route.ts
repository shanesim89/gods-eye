import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { council_verdict_cache } from "@/db/schema";
import { and, eq, gte } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { buildContext } from "@/lib/council/context";
import { getRoles, runAgent } from "@/lib/council/agents";
import { synthesizeVerdict } from "@/lib/council/synthesize";
import type { AssetClass, StreamEvent, Verdict } from "@/lib/council/types";

export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function sse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(sse(event)));
      };

      try {
        // Auth
        const user = await requireUser();

        // Parse body
        const body = await req.json() as { ticker?: string; assetClass?: string };
        const ticker = (body.ticker ?? "").toUpperCase().trim();
        const assetClass = (body.assetClass ?? "stocks") as AssetClass;

        if (!ticker) {
          emit({ type: "error", message: "ticker required" });
          controller.close();
          return;
        }

        // Check cache
        const cutoff = new Date(Date.now() - CACHE_TTL_MS);
        const cached = await db
          .select()
          .from(council_verdict_cache)
          .where(
            and(
              eq(council_verdict_cache.user_id, user.id),
              eq(council_verdict_cache.ticker, ticker),
              eq(council_verdict_cache.asset_class, assetClass),
              gte(council_verdict_cache.fetched_at, cutoff)
            )
          )
          .limit(1);

        if (cached.length > 0) {
          const row = cached[0];
          const payload = row.payload as {
            summary?: string;
            agents?: Verdict["agents"];
            tradeLevels?: Verdict["tradeLevels"];
            currency?: string;
          };
          const verdict: Verdict = {
            verdict: row.verdict as Verdict["verdict"],
            confidence: row.confidence ?? 50,
            summary: payload.summary ?? "",
            agents: payload.agents ?? [],
            generatedAt: row.fetched_at.toISOString(),
            tradeLevels: payload.tradeLevels ?? null,
            currency: payload.currency ?? "USD",
          };
          emit({ type: "verdict", data: verdict });
          controller.close();
          return;
        }

        // Build context
        const ctx = await buildContext(assetClass, ticker);

        // Emit agent_start for all roles
        const roles = getRoles(assetClass);
        roles.forEach((role) => emit({ type: "agent_start", role }));

        // Run all agents in parallel
        const anthropic = new Anthropic();
        const agentResults = await Promise.all(
          roles.map((role) => runAgent(role, ctx, anthropic))
        );

        // Emit each agent result as it completes
        agentResults.forEach((result) => emit({ type: "agent_done", result }));

        // Synthesize
        emit({ type: "synth_start" });
        const verdict = await synthesizeVerdict(agentResults, ctx, anthropic);

        // Insert fresh cache row (old rows filtered by fetched_at cutoff in reads)
        await db.insert(council_verdict_cache).values({
          user_id: user.id,
          ticker,
          asset_class: assetClass,
          verdict: verdict.verdict,
          confidence: verdict.confidence,
          payload: {
            summary: verdict.summary,
            agents: verdict.agents,
            tradeLevels: verdict.tradeLevels,
            currency: verdict.currency,
          } as Record<string, unknown>,
          fetched_at: new Date(),
        });

        emit({ type: "verdict", data: verdict });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        controller.enqueue(encoder.encode(sse({ type: "error", message })));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
