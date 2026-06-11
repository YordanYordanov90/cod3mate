function Shimmer({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-muted/60 ${className}`} />;
}

export function ReportsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading reports">
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface-card px-4 py-3.5">
            <div className="flex gap-3">
              <Shimmer className="size-8 shrink-0 rounded-md" />
              <div className="flex-1 space-y-2">
                <Shimmer className="h-3 w-20" />
                <Shimmer className="h-7 w-16" />
                <Shimmer className="h-3 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="surface-card overflow-hidden">
        <div className="divide-y divide-border/80">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Shimmer className="h-5 w-16 rounded-full" />
              <Shimmer className="h-4 flex-1" />
              <Shimmer className="hidden h-4 w-16 sm:block" />
              <Shimmer className="hidden h-4 w-20 sm:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}