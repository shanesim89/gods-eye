import "server-only";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db/client";
import { market_outlook_articles } from "@/db/schema";
import { scrapeAllSources } from "@/lib/market-outlook/scrape";
import { summarizeOutlook } from "@/lib/market-outlook/summarize";
import { requireUser } from "@/lib/auth";

export async function POST() {
  await requireUser();

  const { articles, skipped } = await scrapeAllSources();

  if (articles.length === 0) {
    return NextResponse.json(
      { error: "All sources unreachable or gated.", skipped },
      { status: 502 }
    );
  }

  for (const a of articles) {
    await db
      .insert(market_outlook_articles)
      .values({ source: a.source, url: a.url, title: a.title, content: a.content })
      .onConflictDoUpdate({
        target: market_outlook_articles.url,
        set: { title: a.title, content: a.content, fetched_at: new Date() },
      });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const digest = await summarizeOutlook(articles, anthropic);

  return NextResponse.json({
    digest,
    sources: articles.map((a) => ({ source: a.source, url: a.url, title: a.title })),
    skipped,
  });
}
