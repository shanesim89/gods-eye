import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { scanner_watchlist } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select({ coin_id: scanner_watchlist.coin_id })
      .from(scanner_watchlist)
      .where(eq(scanner_watchlist.user_id, user.id));
    return Response.json(rows.map((r) => r.coin_id));
  } catch {
    return Response.json([]);
  }
}

export async function POST(req: Request) {
  const user = await requireUser();
  const body = (await req.json()) as { coin_id?: string; symbol?: string; name?: string };
  const { coin_id, symbol, name } = body;
  if (!coin_id || !symbol || !name)
    return Response.json({ error: "missing fields" }, { status: 400 });
  await db
    .insert(scanner_watchlist)
    .values({ user_id: user.id, coin_id, symbol, name })
    .onConflictDoNothing();
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const coin_id = url.searchParams.get("coin_id");
  if (!coin_id)
    return Response.json({ error: "missing coin_id" }, { status: 400 });
  await db
    .delete(scanner_watchlist)
    .where(
      and(
        eq(scanner_watchlist.user_id, user.id),
        eq(scanner_watchlist.coin_id, coin_id)
      )
    );
  return Response.json({ ok: true });
}
