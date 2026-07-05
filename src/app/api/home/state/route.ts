import { requireUser } from "@/lib/auth";
import { buildHomeState } from "@/lib/ai-portfolio/overview";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  const data = await buildHomeState(user.id);
  return Response.json({ payload: data, fetched_at: data.generatedAt });
}
