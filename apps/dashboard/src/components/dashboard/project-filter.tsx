import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DashboardProject } from "@/lib/api-contract";

function chipHref(project: string | null): string {
  return project ? `/?project=${encodeURIComponent(project)}` : "/";
}

const baseChip =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-[background-color,border-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const activeChip = "border-primary/40 bg-primary/15 text-foreground";
const idleChip =
  "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground";

export function ProjectFilter({
  projects,
  activeProject,
}: {
  projects: DashboardProject[];
  activeProject: string | null;
}) {
  if (projects.length === 0) {
    return null;
  }

  const totalCount = projects.reduce((sum, p) => sum + p.reportCount, 0);

  return (
    <nav
      aria-label="Filter reports by project"
      className="flex flex-wrap items-center gap-1.5"
    >
      <Link
        href={chipHref(null)}
        aria-current={activeProject === null ? "page" : undefined}
        className={cn(baseChip, activeProject === null ? activeChip : idleChip)}
      >
        All
        <span className="tabular-nums opacity-60">{totalCount}</span>
      </Link>

      {projects.map((project) => {
        const isActive = project.name === activeProject;
        return (
          <Link
            key={project.name}
            href={chipHref(project.name)}
            aria-current={isActive ? "page" : undefined}
            className={cn(baseChip, isActive ? activeChip : idleChip)}
          >
            <span className="max-w-[12rem] truncate">{project.name}</span>
            <span className="tabular-nums opacity-60">
              {project.reportCount}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
