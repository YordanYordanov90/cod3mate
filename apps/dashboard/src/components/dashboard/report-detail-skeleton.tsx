function Shimmer({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-muted/60 ${className}`} />;
}

export function ReportDetailSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading report">
      <div className="space-y-5">
        <Shimmer className="h-4 w-20" />
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Shimmer className="h-7 w-64" />
            <Shimmer className="h-4 w-32" />
          </div>
          <Shimmer className="h-6 w-16 rounded-full" />
        </div>
        <div className="surface-card grid grid-cols-2 gap-4 px-4 py-3.5 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Shimmer className="h-3 w-16" />
              <Shimmer className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Shimmer className="h-7 w-36" />
        <div className="surface-card divide-y divide-border/80 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Shimmer className="size-4 rounded-full" />
              <Shimmer className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Shimmer className="h-7 w-36" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Shimmer key={i} className="aspect-video w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}