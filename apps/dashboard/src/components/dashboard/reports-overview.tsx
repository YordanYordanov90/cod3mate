import { Activity, CircleAlert, CircleCheck, Clock } from "lucide-react";
import { loadReportsOverview } from "@/lib/reports-overview";
import { formatPercent, formatRelative, formatTimestamp } from "@/lib/format";
import { StatCard, type StatTone } from "./stat-card";
import { ProjectFilter } from "./project-filter";
import { ReportsTable } from "./reports-table";
import { EmptyState, ErrorState } from "./states";

function passRateTone(passRate: number, evaluableRuns: number): StatTone {
  if (evaluableRuns === 0) return "default";
  if (passRate >= 90) return "success";
  if (passRate < 50) return "destructive";
  return "default";
}

export async function ReportsOverview({ project }: { project?: string }) {
  const result = await loadReportsOverview(project);

  if (result.status === "error") {
    return <ErrorState message={result.message} />;
  }

  const { projects, reports, summary, activeProject, now } = result;

  return (
    <div className="space-y-6">
      <ProjectFilter projects={projects} activeProject={activeProject} />

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total runs"
          value={String(summary.totalRuns)}
          sub={activeProject ?? "across all projects"}
          icon={Activity}
        />
        <StatCard
          label="Pass rate"
          value={
            summary.evaluableRuns > 0 ? formatPercent(summary.passRate) : "—"
          }
          sub={`${summary.passedRuns}/${summary.evaluableRuns} runs clean`}
          tone={passRateTone(summary.passRate, summary.evaluableRuns)}
          icon={CircleCheck}
        />
        <StatCard
          label="Failed checks"
          value={String(summary.failedChecks)}
          sub={summary.failedChecks > 0 ? "needs attention" : "all clear"}
          tone={summary.failedChecks > 0 ? "destructive" : "default"}
          icon={CircleAlert}
        />
        <StatCard
          label="Latest run"
          value={
            summary.latestRunIso ? formatRelative(summary.latestRunIso, now) : "—"
          }
          sub={
            summary.latestRunIso
              ? formatTimestamp(summary.latestRunIso)
              : "no runs yet"
          }
          icon={Clock}
        />
      </div>

      {reports.length === 0 ? (
        <EmptyState activeProject={activeProject} />
      ) : (
        <div className="fade-up">
          <ReportsTable reports={reports} now={now} />
        </div>
      )}
    </div>
  );
}
