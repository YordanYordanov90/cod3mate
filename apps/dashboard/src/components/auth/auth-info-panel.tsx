import { Activity, Camera, FileSearch, Layers } from "lucide-react";

const features = [
  {
    icon: FileSearch,
    title: "QA reports",
    description: "Browse runs from the Telegram agent, grouped by project.",
  },
  {
    icon: Camera,
    title: "Screenshots",
    description: "Inspect captured states and failure evidence in context.",
  },
  {
    icon: Layers,
    title: "Assertions",
    description: "See passed and failed checks without digging through chat.",
  },
] as const;

export function AuthInfoPanel() {
  return (
    <aside className="auth-panel relative flex flex-col justify-between overflow-hidden border-b border-border px-6 py-10 sm:px-10 lg:border-b-0 lg:border-r lg:px-14 lg:py-16">
      <div className="auth-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="auth-grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden />

      <div className="relative z-10 stagger">
        <div className="inline-flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-card/80 shadow-sm">
            <Activity className="size-4 text-primary" aria-hidden />
          </span>
          <span className="text-sm font-semibold tracking-tight">cod3mate QA</span>
        </div>

        <div className="mt-10 max-w-md space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl lg:text-[2rem] lg:leading-tight">
            QA intelligence,
            <span className="text-muted-foreground"> at a glance.</span>
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty sm:text-[0.9375rem]">
            A read-only dashboard for QA runs from the cod3mate Telegram agent.
            Review reports, screenshots, and assertions in one place.
          </p>
        </div>

        <ul className="mt-10 hidden max-w-md space-y-5 sm:block">
          {features.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex gap-3.5">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card/60">
                <Icon className="size-3.5 text-primary" aria-hidden />
              </span>
              <div className="space-y-0.5">
                <p className="text-sm font-medium tracking-tight">{title}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative z-10 mt-10 text-xs text-muted-foreground/80 lg:mt-0">
        Private portfolio · Telegram agent on Railway
      </p>
    </aside>
  );
}