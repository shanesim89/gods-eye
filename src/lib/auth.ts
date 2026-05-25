import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Ensure a row in users exists for the current Clerk user.
 * Returns the internal users.id (uuid).
 * Throws if not signed in.
 */
export async function getOrCreateUser(): Promise<{
  id: string;
  clerk_id: string;
  email: string | null;
  base_currency: string;
}> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  // Look up existing
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.clerk_id, userId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  // Create new — fetch email from Clerk
  const cu = await currentUser();
  const email =
    cu?.emailAddresses?.find((e) => e.id === cu.primaryEmailAddressId)
      ?.emailAddress ?? cu?.emailAddresses?.[0]?.emailAddress ?? null;

  const [row] = await db
    .insert(users)
    .values({
      clerk_id: userId,
      email,
      base_currency: "USD",
    })
    .returning();

  return row;
}

/** Helper for server actions / route handlers. */
export async function requireUser() {
  return getOrCreateUser();
}
