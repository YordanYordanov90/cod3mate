import { Suspense } from "react";
import { FileSearch } from "lucide-react";
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
      <header className="stagger mb-10 space-y-4">
        <div className="inline-flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-card/80 shadow-sm">
            <FileSearch className="size-4 text-primary" aria-hidden />
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Portfolio overview
          </span>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
            QA runs,
            <span className="text-muted-foreground"> at a glance.</span>
          </h1>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground text-pretty">
            Read-only view of reports from the Telegram agent — grouped by
            project, with pass rates and failure signals up front.
          </p>
        </div>
      </header>

      <Suspense key={project ?? "all"} fallback={<ReportsSkeleton />}>
        <ReportsOverview {...(project ? { project } : {})} />
      </Suspense>
    </main>
  );
}