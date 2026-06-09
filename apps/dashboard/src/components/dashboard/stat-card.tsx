import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "success" | "destructive";

const VALUE_TONE: Record<StatTone, string> = {
  default: "text-foreground",
  success: "text-success",
  destructive: "text-destructive",
};

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  tone?: StatTone;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        ) : null}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
          VALUE_TONE[tone],
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}
