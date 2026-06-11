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
    <div className="surface-card px-4 py-3.5">
      <div className="flex items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background/40">
            <Icon
              className={cn(
                "size-3.5",
                tone === "success"
                  ? "text-success"
                  : tone === "destructive"
                    ? "text-destructive"
                    : "text-primary",
              )}
              aria-hidden
            />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              "mt-1.5 text-2xl font-semibold tabular-nums tracking-tight",
              VALUE_TONE[tone],
            )}
          >
            {value}
          </p>
          {sub ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {sub}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}