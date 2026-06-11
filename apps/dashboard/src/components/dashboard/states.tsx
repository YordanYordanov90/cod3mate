import Link from "next/link";
import { FileQuestion, Inbox, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

function StateIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-card/60">
      {children}
    </span>
  );
}

export function EmptyState({
  activeProject,
}: {
  activeProject: string | null;
}) {
  return (
    <div className="surface-card flex flex-col items-center justify-center border-dashed px-6 py-16 text-center">
      <StateIcon>
        <Inbox className="size-5 text-muted-foreground" aria-hidden />
      </StateIcon>
      <h2 className="mt-4 text-sm font-medium text-foreground">
        {activeProject ? `No reports for "${activeProject}"` : "No QA reports yet"}
      </h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {activeProject
          ? "Try clearing the project filter or run a QA test from Telegram."
          : "Reports appear here after the agent runs /qa-test or uses qa_assert_* tools during a QA run."}
      </p>
      {activeProject ? (
        <Link href="/" className={`${buttonVariants({ variant: "outline" })} mt-6`}>
          Clear filter
        </Link>
      ) : null}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="surface-card flex flex-col items-center justify-center border-destructive/30 bg-destructive/5 px-6 py-16 text-center">
      <StateIcon>
        <TriangleAlert className="size-5 text-destructive" aria-hidden />
      </StateIcon>
      <h2 className="mt-4 text-sm font-medium text-foreground">
        Couldn&apos;t load reports
      </h2>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

export function NotFoundState() {
  return (
    <div className="surface-card flex flex-col items-center justify-center border-dashed px-6 py-16 text-center">
      <StateIcon>
        <FileQuestion className="size-5 text-muted-foreground" aria-hidden />
      </StateIcon>
      <h2 className="mt-4 text-sm font-medium text-foreground">
        Report not found
      </h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        This report no longer exists or was never recorded.
      </p>
      <Link href="/" className={`${buttonVariants({ variant: "outline" })} mt-6`}>
        Back to reports
      </Link>
    </div>
  );
}