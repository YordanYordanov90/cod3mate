import { CircleCheck, CircleX, MinusCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardReport } from "@/lib/api-contract";
import { formatDuration } from "@/lib/format";

type EntryStatus = DashboardReport["entries"][number]["status"];
type Entry = DashboardReport["entries"][number];

const STATUS_META: Record<
  EntryStatus,
  { icon: LucideIcon; tint: string; label: string }
> = {
  pass: { icon: CircleCheck, tint: "text-success", label: "Pass" },
  fail: { icon: CircleX, tint: "text-destructive", label: "Fail" },
  skip: { icon: MinusCircle, tint: "text-muted-foreground", label: "Skip" },
};

function AssertionRow({ entry }: { entry: Entry }) {
  const meta = STATUS_META[entry.status];
  const Icon = meta.icon;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", meta.tint)}
        aria-label={meta.label}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="break-words text-sm font-medium text-foreground">
            {entry.name}
          </span>
          {entry.durationMs != null ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatDuration(entry.durationMs)}
            </span>
          ) : null}
        </div>
        {entry.details ? (
          <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {entry.details}
          </pre>
        ) : null}
      </div>
    </li>
  );
}

function Section({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone?: "destructive";
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
        {title}
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
            tone === "destructive"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </ul>
    </section>
  );
}

export function AssertionList({ report }: { report: DashboardReport }) {
  const { entries } = report;

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        This report has no recorded assertions.
      </div>
    );
  }

  const failed = entries.filter((e) => e.status === "fail");

  return (
    <div className="space-y-6">
      {failed.length > 0 ? (
        <Section title="Failed checks" count={failed.length} tone="destructive">
          {failed.map((entry, i) => (
            <AssertionRow key={`fail-${i}`} entry={entry} />
          ))}
        </Section>
      ) : null}

      <Section title="All checks" count={entries.length}>
        {entries.map((entry, i) => (
          <AssertionRow key={`all-${i}`} entry={entry} />
        ))}
      </Section>
    </div>
  );
}
