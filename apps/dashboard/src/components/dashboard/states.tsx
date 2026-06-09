import Link from "next/link";
import { FileQuestion, Inbox, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export function EmptyState({
  activeProject,
}: {
  activeProject: string | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Inbox className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="mt-4 text-sm font-medium text-foreground">
        {activeProject ? `No reports for "${activeProject}"` : "No QA reports yet"}
      </h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {activeProject
          ? "Try clearing the project filter or run a QA test from Telegram."
          : "Reports appear here after the agent runs a QA test with assertions."}
      </p>
      {activeProject ? (
        <Link href="/" className={`${buttonVariants({ variant: "outline" })} mt-5`}>
          Clear filter
        </Link>
      ) : null}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10">
        <TriangleAlert className="size-5 text-destructive" aria-hidden />
      </div>
      <h2 className="mt-4 text-sm font-medium text-foreground">
        Couldn&apos;t load reports
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function NotFoundState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="mt-4 text-sm font-medium text-foreground">
        Report not found
      </h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        This report no longer exists or was never recorded.
      </p>
      <Link href="/" className={`${buttonVariants({ variant: "outline" })} mt-5`}>
        Back to reports
      </Link>
    </div>
  );
}
