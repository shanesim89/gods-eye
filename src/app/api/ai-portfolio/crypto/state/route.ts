import { requireUser } from "@/lib/auth";
import { getCryptoDashboardData } from "@/lib/trading/crypto-dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  const data = await getCryptoDashboardData(user.id);
  return Response.json({ payload: data, fetched_at: new Date().toISOString() });
}
