import { Suspense } from "react";
import { Globe } from "lucide-react";
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
      <div className="mb-8 flex items-center justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
          <Globe className="size-3" aria-hidden />
          Portfolio
        </span>
      </div>

      <Suspense key={id} fallback={<ReportDetailSkeleton />}>
        <ReportDetail id={id} />
      </Suspense>
    </main>
  );
}
