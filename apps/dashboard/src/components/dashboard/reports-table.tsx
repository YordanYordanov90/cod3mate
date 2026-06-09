import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardReport } from "@/lib/api-contract";
import { reportRunStatus } from "@/lib/reports-overview";
import { formatDuration, formatRelative, formatTimestamp } from "@/lib/format";
import { StatusBadge } from "./status-badge";

const GRID =
  "grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[6rem_minmax(0,1fr)_5.5rem_5rem_9rem_auto] items-center gap-x-3";

function ChecksCell({ report }: { report: DashboardReport }) {
  const { passed, total, failed } = report.summary;
  return (
    <span className="tabular-nums">
      <span className="text-foreground">{passed}</span>
      <span className="text-muted-foreground">/{total}</span>
      {failed > 0 ? (
        <span className="ml-1 text-destructive">· {failed} failed</span>
      ) : null}
    </span>
  );
}

export function ReportsTable({
  reports,
  now,
}: {
  reports: DashboardReport[];
  now: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        className={cn(
          GRID,
          "hidden border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid",
        )}
      >
        <span>Status</span>
        <span>Report</span>
        <span>Checks</span>
        <span>Duration</span>
        <span className="text-right">Started</span>
        <span aria-hidden />
      </div>

      <ul className="divide-y divide-border">
        {reports.map((report) => {
          const status = reportRunStatus(report);
          return (
            <li key={report.id}>
              <Link
                href={`/reports/${encodeURIComponent(report.id)}`}
                className={cn(
                  GRID,
                  "group px-4 py-3 text-sm transition-colors duration-150 ease-out hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                )}
              >
                <StatusBadge status={status} className="justify-self-start" />

                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">
                    {report.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {report.project}
                    <span className="sm:hidden">
                      {" · "}
                      {report.summary.passed}/{report.summary.total} checks
                      {" · "}
                      {formatRelative(report.startedAt, now)}
                    </span>
                  </span>
                </span>

                <span className="hidden text-xs text-muted-foreground sm:block">
                  <ChecksCell report={report} />
                </span>

                <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
                  {formatDuration(report.durationMs)}
                </span>

                <span
                  className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block"
                  title={formatTimestamp(report.startedAt)}
                >
                  {formatRelative(report.startedAt, now)}
                </span>

                <ChevronRight
                  className="hidden size-4 text-muted-foreground/50 transition-[color,transform] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-muted-foreground sm:block"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
