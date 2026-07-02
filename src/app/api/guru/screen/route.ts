import { parseTheme } from "@/lib/screen/parse";
import { runScreen } from "@/lib/screen/run";
import type { AssetClass } from "@/lib/screen/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Trend Spotting: NL theme -> parsed screen spec -> ranked universe matches.
// Reuses the crypto scanner / stock leaders / dip-bounce cached snapshots.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { theme?: string; assetClass?: string };
    const theme = (body.theme ?? "").trim();
    const assetClass = (body.assetClass === "stocks" ? "stocks" : "crypto") as AssetClass;

    if (!theme || theme.length < 3) {
      return Response.json({ error: "theme too short" }, { status: 400 });
    }
    if (theme.length > 400) {
      return Response.json({ error: "theme too long" }, { status: 400 });
    }

    const spec = await parseTheme(theme, assetClass);
    const result = await runScreen(spec);
    result.theme = theme;
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "screen failed" },
      { status: 500 }
    );
  }
}
