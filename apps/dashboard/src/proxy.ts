import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Clerk middleware (Next.js 16 uses `proxy.ts`; Next.js <=15 used `middleware.ts`).
 *
 * The portfolio dashboard requires sign-in, so EVERY route is protected except
 * the auth pages. `auth.protect()` redirects signed-out users to `/sign-in`.
 *
 * This only enforces *authentication* (any signed-in Clerk user). All QA reports
 * from the Railway API are visible to signed-in users, grouped by project hostname.
 */
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};
