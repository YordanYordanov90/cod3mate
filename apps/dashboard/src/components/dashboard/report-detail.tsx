import { loadReportDetail } from "@/lib/report-detail";
import { ReportDetailHeader } from "./report-detail-header";
import { AssertionList } from "./assertion-list";
import { ScreenshotGallery } from "./screenshot-gallery";
import { TranscriptView } from "./transcript-view";
import { ErrorState, NotFoundState } from "./states";
import { loadReportTranscript } from "@/lib/report-transcript";

export async function ReportDetail({ id }: { id: string }) {
  const result = await loadReportDetail(id);

  if (result.status === "not_found") {
    return <NotFoundState />;
  }

  if (result.status === "error") {
    return <ErrorState message={result.message} />;
  }

  const { report, now } = result;
  const transcriptResult = await loadReportTranscript(id);

  return (
    <div className="fade-up space-y-8">
      <ReportDetailHeader report={report} now={now} />
      <AssertionList report={report} />
      {transcriptResult.status === "ok" ? (
        <TranscriptView reportId={report.id} transcript={transcriptResult.transcript} />
      ) : null}
      <ScreenshotGallery reportId={report.id} screenshots={report.screenshots} />
    </div>
  );
}
