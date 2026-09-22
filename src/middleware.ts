import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [/^\/login(\/.*)?$/, /^\/api\/login$/, /^\/api\/ticker$/, /^\/api\/cron(\/.*)?$/];

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((re) => re.test(pathname))) return NextResponse.next();

  const secret = process.env.PIN_SECRET;
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const expected = secret ? await sign(SESSION_VALUE, secret) : null;

  if (cookie && expected && cookie === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Skip Next internals + all static files unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
