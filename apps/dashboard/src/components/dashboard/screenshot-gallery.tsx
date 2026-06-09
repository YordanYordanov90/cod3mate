import { ImageOff } from "lucide-react";
import type { DashboardScreenshot } from "@/lib/api-contract";
import { screenshotProxyUrl } from "@/lib/report-detail";

export function ScreenshotGallery({
  reportId,
  screenshots,
}: {
  reportId: string;
  screenshots: DashboardScreenshot[];
}) {
  return (
    <section className="space-y-2.5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
        Screenshots
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
          {screenshots.length}
        </span>
      </h2>

      {screenshots.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted">
            <ImageOff className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            No screenshots were captured for this report.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {screenshots.map((shot, i) => {
            const src = screenshotProxyUrl(reportId, shot.filename);
            const label = shot.label ?? shot.filename;
            return (
              <li key={`${shot.filename}-${i}`}>
                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block overflow-hidden rounded-lg border border-border bg-card transition-colors duration-150 ease-out hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="aspect-video overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private proxied binary; next/image optimization is inappropriate */}
                    <img
                      src={src}
                      alt={label}
                      loading="lazy"
                      className="size-full object-cover object-top transition-transform duration-200 ease-out group-hover:scale-[1.02]"
                    />
                  </div>
                  <p className="truncate px-3 py-2 text-xs text-muted-foreground">
                    {label}
                  </p>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
