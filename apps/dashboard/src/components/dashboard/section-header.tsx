import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function SectionHeader({
  title,
  count,
  icon: Icon,
  tone,
  aside,
}: {
  title: string;
  count?: number;
  icon?: LucideIcon;
  tone?: "destructive";
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2.5 text-sm font-medium tracking-tight text-foreground">
        {Icon ? (
          <span className="flex size-7 items-center justify-center rounded-md border border-border bg-card/60">
            <Icon className="size-3.5 text-primary" aria-hidden />
          </span>
        ) : null}
        {title}
        {count != null ? (
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
        ) : null}
      </h2>
      {aside}
    </div>
  );
}