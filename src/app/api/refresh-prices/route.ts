import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { refreshUserAssets } from "@/lib/refresh-assets";

export async function POST() {
  try {
    const user = await requireUser();
    const result = await refreshUserAssets(user.id, { force: true });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Allow GET for quick browser test (no-op for non-authed)
export async function GET() {
  return POST();
}
