import { requireUser } from "@/lib/auth";
import { getUniverseDashboardData } from "@/lib/trading/universe-dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireUser();
  const payload = await getUniverseDashboardData();
  return Response.json({ payload, fetched_at: new Date().toISOString() });
}
