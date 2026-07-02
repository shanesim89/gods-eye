import { requireUser } from "@/lib/auth";
import { getOptionsDashboardData } from "@/lib/trading/options-dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  const data = await getOptionsDashboardData(user.id);
  return Response.json({ payload: data, fetched_at: new Date().toISOString() });
}
