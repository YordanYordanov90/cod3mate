import { loadReportDetail } from "@/lib/report-detail";
import { ReportDetailHeader } from "./report-detail-header";
import { AssertionList } from "./assertion-list";
import { ScreenshotGallery } from "./screenshot-gallery";
import { ErrorState, NotFoundState } from "./states";

export async function ReportDetail({ id }: { id: string }) {
  const result = await loadReportDetail(id);

  if (result.status === "not_found") {
    return <NotFoundState />;
  }

  if (result.status === "error") {
    return <ErrorState message={result.message} />;
  }

  const { report, now } = result;

  return (
    <div className="fade-up space-y-8">
      <ReportDetailHeader report={report} now={now} />
      <AssertionList report={report} />
      <ScreenshotGallery reportId={report.id} screenshots={report.screenshots} />
    </div>
  );
}
