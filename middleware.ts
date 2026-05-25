import { NextResponse, type NextRequest } from "next/server";

export function middleware(_req: NextRequest) {
  // Clerk wiring deferred until NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is set.
  // When keys land: replace this file with clerkMiddleware() from @clerk/nextjs/server
  // and wrap layout.tsx with <ClerkProvider>.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
