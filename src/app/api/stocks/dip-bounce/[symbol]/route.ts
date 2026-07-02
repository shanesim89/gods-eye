import { getCompanyNews } from "@/lib/finnhub";
import { getYahooSummary } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Per-ticker detail for the dip-bounce drawer: news + analyst consensus.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  try {
    const [news, summary] = await Promise.all([
      getCompanyNews(sym),
      getYahooSummary(sym),
    ]);
    return Response.json({ news: news ?? [], summary });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "detail failed", news: [], summary: null },
      { status: 500 }
    );
  }
}
