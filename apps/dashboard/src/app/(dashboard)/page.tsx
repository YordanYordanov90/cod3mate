import { Suspense } from "react";
import { Globe } from "lucide-react";
import { ReportsOverview } from "@/components/dashboard/reports-overview";
import { ReportsSkeleton } from "@/components/dashboard/reports-skeleton";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams: Promise<{ project?: string | string[] }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const project =
    typeof params.project === "string" ? params.project : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">QA Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Read-only view of QA runs from the Telegram agent.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
          <Globe className="size-3" aria-hidden />
          Portfolio
        </span>
      </header>

      <div className="mt-8">
        <Suspense key={project ?? "all"} fallback={<ReportsSkeleton />}>
          <ReportsOverview {...(project ? { project } : {})} />
        </Suspense>
      </div>
    </main>
  );
}
