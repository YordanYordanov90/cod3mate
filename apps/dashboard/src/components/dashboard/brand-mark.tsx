import Link from "next/link";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({
  href = "/",
  className,
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 transition-opacity duration-150 ease-out hover:opacity-90 active:scale-[0.98]",
        className,
      )}
    >
      <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-card/80 shadow-sm">
        <Activity className="size-4 text-primary" aria-hidden />
      </span>
      <span className="text-sm font-semibold tracking-tight">cod3mate QA</span>
    </Link>
  );
}