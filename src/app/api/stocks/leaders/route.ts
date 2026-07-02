import { getLeadersResult } from "@/lib/stocks/leaders";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Serves the latest momentum/growth leaders snapshot. Computed by the Python
// pipeline and written to Neon; read-only here (no refresh).
export async function GET() {
  try {
    const result = await getLeadersResult();
    if (!result) {
      return Response.json({ error: "no leaders snapshot yet" }, { status: 404 });
    }
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "read failed" },
      { status: 500 }
    );
  }
}
