import { getDipResult } from "@/lib/stocks/dip-bounce";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Serves the latest dip-bounce snapshot. The scan itself is computed by the
// Python pipeline and written to Neon; this route is read-only (no refresh).
export async function GET() {
  try {
    const result = await getDipResult();
    if (!result) {
      return Response.json({ error: "no dip-bounce snapshot yet" }, { status: 404 });
    }
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "read failed" },
      { status: 500 }
    );
  }
}
