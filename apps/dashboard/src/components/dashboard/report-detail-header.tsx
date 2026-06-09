import Link from "next/link";
import { ArrowLeft, FolderGit2 } from "lucide-react";
import type { DashboardReport } from "@/lib/api-contract";
import { reportRunStatus } from "@/lib/reports-overview";
import { formatDuration, formatRelative, formatTimestamp } from "@/lib/format";
import { StatusBadge } from "./status-badge";

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

export function ReportDetailHeader({
  report,
  now,
}: {
  report: DashboardReport;
  now: number;
}) {
  const status = reportRunStatus(report);
  const { total, passed, failed, skipped } = report.summary;

  return (
    <header className="space-y-5">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Reports
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {report.title}
          </h1>
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <FolderGit2 className="size-3.5" aria-hidden />
            <span className="truncate">{report.project}</span>
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-card px-4 py-3.5 sm:grid-cols-4">
        <MetaItem
          label="Started"
          value={formatRelative(report.startedAt, now)}
        />
        <MetaItem label="Duration" value={formatDuration(report.durationMs)} />
        <MetaItem
          label="Checks"
          value={total > 0 ? `${passed}/${total} passed` : "no checks"}
        />
        <MetaItem
          label="Failed"
          value={failed > 0 ? String(failed) : skipped > 0 ? `0 · ${skipped} skipped` : "0"}
        />
      </dl>

      <p className="text-xs tabular-nums text-muted-foreground">
        {formatTimestamp(report.startedAt)}
        {report.endedAt ? ` → ${formatTimestamp(report.endedAt)}` : null}
      </p>
    </header>
  );
}
