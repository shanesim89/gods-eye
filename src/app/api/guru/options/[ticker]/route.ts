import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { loadOptionsAnalysis } from "@/lib/options/load";
import type { OptType } from "@/lib/options/blackscholes";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  await requireUser();
  const { ticker } = await params;
  const sp = req.nextUrl.searchParams;

  const result = await loadOptionsAnalysis(decodeURIComponent(ticker), {
    exp: sp.get("exp") ? Number(sp.get("exp")) : undefined,
    strike: sp.get("strike") ? Number(sp.get("strike")) : undefined,
    type: (sp.get("type") as OptType | null) ?? undefined,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : 404,
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
