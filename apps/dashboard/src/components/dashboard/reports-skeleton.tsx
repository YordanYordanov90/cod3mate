function Shimmer({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

export function ReportsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading reports">
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} className="h-7 w-20" />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card px-4 py-3.5"
          >
            <Shimmer className="h-3 w-20" />
            <Shimmer className="mt-3 h-7 w-16" />
            <Shimmer className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3.5"
            >
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
