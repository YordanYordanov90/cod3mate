import { Suspense } from "react";
import { Layers } from "lucide-react";
import { ReportDetail } from "@/components/dashboard/report-detail";
import { ReportDetailSkeleton } from "@/components/dashboard/report-detail-skeleton";

export const dynamic = "force-dynamic";

interface ReportDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ReportDetailPage({
  params,
}: ReportDetailPageProps) {
  const { id } = await params;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
      <header className="stagger mb-10 space-y-4">
        <div className="inline-flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-card/80 shadow-sm">
            <Layers className="size-4 text-primary" aria-hidden />
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Report detail
          </span>
        </div>
      </header>

      <Suspense key={id} fallback={<ReportDetailSkeleton />}>
        <ReportDetail id={id} />
      </Suspense>
    </main>
  );
}