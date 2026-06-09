import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/reports-overview";

const STYLES: Record<RunStatus, string> = {
  pass: "bg-success/10 text-success ring-success/25",
  fail: "bg-destructive/10 text-destructive ring-destructive/30",
  empty: "bg-muted text-muted-foreground ring-border",
};

const DOT: Record<RunStatus, string> = {
  pass: "bg-success",
  fail: "bg-destructive",
  empty: "bg-muted-foreground",
};

const LABEL: Record<RunStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  empty: "No checks",
};

export function StatusBadge({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        STYLES[status],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[status])} aria-hidden />
      {LABEL[status]}
    </span>
  );
}
