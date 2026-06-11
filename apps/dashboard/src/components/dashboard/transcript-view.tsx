import { Bot, Hammer, MessageSquare, ScrollText, Terminal } from "lucide-react";
import type { DashboardTranscript, DashboardTranscriptEntry } from "@/lib/api-contract";
import { screenshotProxyUrl } from "@/lib/report-detail";
import { SectionHeader } from "./section-header";

function entryIcon(kind: DashboardTranscriptEntry["kind"]) {
  switch (kind) {
    case "model_message":
      return Bot;
    case "tool_call":
    case "tool_result":
      return Hammer;
    case "steering":
      return MessageSquare;
    case "run_end":
      return Terminal;
    default:
      return Terminal;
  }
}

function entryTitle(entry: DashboardTranscriptEntry): string {
  switch (entry.kind) {
    case "model_message":
      return entry.iteration != null
        ? `Model · step ${entry.iteration + 1}`
        : "Model";
    case "tool_call":
      return `Tool call · ${entry.toolName ?? "unknown"}`;
    case "tool_result":
      return `Tool result · ${entry.toolName ?? "unknown"}`;
    case "steering":
      return "Owner steering";
    case "run_end":
      return "Run ended";
    default:
      return "Entry";
  }
}

export function TranscriptView({
  reportId,
  transcript,
}: {
  reportId: string;
  transcript: DashboardTranscript;
}) {
  return (
    <section className="space-y-3">
      <SectionHeader
        title="Run transcript"
        count={transcript.entries.length}
        icon={ScrollText}
        aside={
          transcript.modelUsed ? (
            <span className="text-xs text-muted-foreground">
              {transcript.modelUsed}
            </span>
          ) : undefined
        }
      />

      <ol className="space-y-3">
        {transcript.entries.map((entry) => {
          const Icon = entryIcon(entry.kind);
          const isToolResult = entry.kind === "tool_result";
          const tone = isToolResult
            ? entry.success
              ? "border-success/20 bg-success/5"
              : "border-destructive/30 bg-destructive/5"
            : "surface-card";

          return (
            <li
              key={`${entry.sequence}-${entry.kind}`}
              className={`fade-up rounded-lg border px-4 py-3 ${tone}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/40">
                  <Icon className="size-3.5 text-primary" aria-hidden />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {entryTitle(entry)}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {entry.timestamp.replace("T", " ").slice(0, 19)} UTC
                    </span>
                  </div>

                  {entry.content ? (
                    <pre className="whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background/40 px-3 py-2 font-mono text-xs leading-relaxed text-foreground/90">
                      {entry.content}
                    </pre>
                  ) : null}

                  {entry.toolArgs && Object.keys(entry.toolArgs).length > 0 ? (
                    <pre className="whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background/30 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
                      {JSON.stringify(entry.toolArgs, null, 2)}
                    </pre>
                  ) : null}

                  {entry.screenshotRef ? (
                    <a
                      href={screenshotProxyUrl(reportId, entry.screenshotRef.filename)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-md border border-border transition-opacity duration-150 ease-out hover:opacity-90"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={screenshotProxyUrl(reportId, entry.screenshotRef.filename)}
                        alt={entry.screenshotRef.label ?? entry.screenshotRef.filename}
                        className="max-h-72 w-full bg-muted/30 object-contain"
                      />
                    </a>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}