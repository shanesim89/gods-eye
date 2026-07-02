import { getScanResult } from "@/lib/crypto/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// On-demand scan data. Serves the cached snapshot; ?refresh=1 forces a fresh
// scan when the cache is older than 10 minutes.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";
  try {
    const result = await getScanResult(force);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "scan failed" },
      { status: 500 }
    );
  }
}
