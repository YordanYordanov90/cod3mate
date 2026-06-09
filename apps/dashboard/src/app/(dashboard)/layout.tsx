import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Authenticated shell for the portfolio dashboard.
 *
 * Clerk middleware (`proxy.ts`) guarantees a signed-in user reaches this layout.
 * Any signed-in user may view all reports (no owner allowlist or curation).
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <Activity className="size-4 text-primary" aria-hidden />
            cod3mate QA
          </Link>
          <UserButton />
        </div>
      </header>
      {children}
    </div>
  );
}
