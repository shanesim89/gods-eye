import "server-only";
import { db } from "@/db/client";
import { users } from "@/db/schema";

// Clerk removed — single-user app gated by a 4-digit PIN in middleware.ts.
// There's only ever one row in `users`; look it up directly rather than by
// clerk_id so the existing row (and everything FK'd to it) stays intact.

/**
 * Ensure the single users row exists. Returns the internal users.id (uuid).
 */
export async function getOrCreateUser(): Promise<{
  id: string;
  clerk_id: string;
  email: string | null;
  base_currency: string;
}> {
  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) return existing[0];

  const [row] = await db
    .insert(users)
    .values({
      clerk_id: "pin-user",
      email: null,
      base_currency: "SGD",
    })
    .returning();

  return row;
}

/** Helper for server actions / route handlers. */
export async function requireUser() {
  return getOrCreateUser();
}
