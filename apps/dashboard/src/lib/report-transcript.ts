import "server-only";

import { getDashboardApiClient } from "./api-client";
import { DashboardApiError } from "./api-errors";
import type { DashboardTranscript } from "./api-contract";

export type ReportTranscriptResult =
  | { status: "ok"; transcript: DashboardTranscript }
  | { status: "not_found" }
  | { status: "error"; kind: DashboardApiError["code"]; message: string };

export async function loadReportTranscript(
  id: string,
): Promise<ReportTranscriptResult> {
  try {
    const client = getDashboardApiClient();
    const transcript = await client.getReportTranscript(id);
    return { status: "ok", transcript };
  } catch (err) {
    if (err instanceof DashboardApiError) {
      if (err.code === "not_found") {
        return { status: "not_found" };
      }
      return { status: "error", kind: err.code, message: err.message };
    }

    return {
      status: "error",
      kind: "unknown",
      message: "Unable to load the QA run transcript.",
    };
  }
}