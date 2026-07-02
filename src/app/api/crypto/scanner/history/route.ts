import { getScoreHistory, getYesterdaySnapshot } from "@/lib/crypto/scanner";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol");
  const snapshot = url.searchParams.get("snapshot");
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? "30")));

  try {
    if (snapshot === "prev") {
      const data = await getYesterdaySnapshot();
      return Response.json(data);
    }
    if (symbol) {
      const data = await getScoreHistory(symbol, days);
      return Response.json(data);
    }
    return Response.json({ error: "provide ?symbol= or ?snapshot=prev" }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "history query failed" },
      { status: 500 }
    );
  }
}
