import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "gods_eye_session";
const SESSION_VALUE = "authenticated";

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Buffer.from(sig).toString("base64url");
}

export async function POST(req: NextRequest) {
  const { pin } = (await req.json()) as { pin?: string };
  const expectedPin = process.env.APP_PIN;
  const secret = process.env.PIN_SECRET;
  if (!expectedPin || !secret) {
    return NextResponse.json({ error: "APP_PIN / PIN_SECRET not configured" }, { status: 500 });
  }
  if (pin !== expectedPin) {
    return NextResponse.json({ error: "Wrong code" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sign(SESSION_VALUE, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
