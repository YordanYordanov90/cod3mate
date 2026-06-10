import "server-only";
import { auth } from "@clerk/nextjs/server";

/**
 * Authentication for the public portfolio dashboard.
 *
 * The dashboard is viewable by any signed-in Clerk user, so there is no owner
 * allowlist. This module only answers "is there a signed-in user?" — Clerk
 * middleware (`proxy.ts`) already enforces this on protected routes; the helper
 * exists for defense-in-depth in server code paths (e.g. the screenshot proxy).
 */
export async function isSignedIn(): Promise<boolean> {
  const { userId } = await auth();
  return Boolean(userId);
}
