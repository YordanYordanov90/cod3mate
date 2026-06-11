import { UserButton } from "@clerk/nextjs";
import { BrandMark } from "@/components/dashboard/brand-mark";

export const dynamic = "force-dynamic";

/**
 * Authenticated shell for the portfolio dashboard.
 *
 * Clerk middleware (`proxy.ts`) guarantees a signed-in user reaches this layout.
 * Any signed-in user may view all QA reports, grouped by inferred project hostname.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="relative min-h-screen">
      <div className="surface-glow pointer-events-none fixed inset-0" aria-hidden />
      <div
        className="surface-grid-bg surface-grid-bg--fade pointer-events-none fixed inset-0 opacity-50"
        aria-hidden
      />

      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <BrandMark />
          <UserButton />
        </div>
      </header>

      <div className="relative z-10">{children}</div>
    </div>
  );
}