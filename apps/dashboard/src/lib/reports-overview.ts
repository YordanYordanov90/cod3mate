import "server-only";

import { getDashboardApiClient } from "./api-client";
import { DashboardApiError } from "./api-client-core";
import type { DashboardApiErrorCode } from "./api-errors";
import type { DashboardProject, DashboardReport } from "./api-contract";

export const OVERVIEW_LIMIT = 50;

export type RunStatus = "pass" | "fail" | "empty";

/** Derive a single run-level status from a report's check summary. */
export function reportRunStatus(report: DashboardReport): RunStatus {
  if (report.summary.total === 0) return "empty";
  return report.summary.failed > 0 ? "fail" : "pass";
}

export interface ReportsSummary {
  totalRuns: number;
  passedRuns: number;
  evaluableRuns: number;
  passRate: number;
  failedChecks: number;
  latestRunIso: string | null;
}

export interface ReportsOverviewData {
  status: "ok";
  projects: DashboardProject[];
  reports: DashboardReport[];
  summary: ReportsSummary;
  activeProject: string | null;
  now: number;
}

export interface ReportsOverviewError {
  status: "error";
  kind: DashboardApiErrorCode | "config";
  message: string;
}

export type ReportsOverviewResult = ReportsOverviewData | ReportsOverviewError;

export function computeReportsSummary(reports: DashboardReport[]): ReportsSummary {
  let passedRuns = 0;
  let evaluableRuns = 0;
  let failedChecks = 0;
  let latestMs = -Infinity;
  let latestRunIso: string | null = null;

  for (const report of reports) {
    failedChecks += report.summary.failed;

    if (report.summary.total > 0) {
      evaluableRuns += 1;
      if (report.summary.failed === 0) {
        passedRuns += 1;
      }
    }

    const started = Date.parse(report.startedAt);
    if (!Number.isNaN(started) && started > latestMs) {
      latestMs = started;
      latestRunIso = report.startedAt;
    }
  }

  const passRate = evaluableRuns > 0 ? (passedRuns / evaluableRuns) * 100 : 0;

  return {
    totalRuns: reports.length,
    passedRuns,
    evaluableRuns,
    passRate,
    failedChecks,
    latestRunIso,
  };
}

const FRIENDLY_MESSAGE: Record<ReportsOverviewError["kind"], string> = {
  config:
    "The dashboard API connection is not configured. Set DASHBOARD_API_BASE_URL and DASHBOARD_API_TOKEN.",
  unavailable: "The Railway dashboard API is unreachable right now.",
  auth: "The dashboard API rejected the server token. Check DASHBOARD_API_TOKEN.",
  invalid_response: "The dashboard API returned an unexpected response.",
  not_found: "The requested dashboard data was not found.",
  unknown: "Something went wrong talking to the dashboard API.",
};

/**
 * Load the reports overview for the given project filter.
 *
 * Never throws — connection, auth, and schema failures are normalized into a
 * typed error result so the UI can render a calm error state.
 */
export async function loadReportsOverview(
  project?: string,
): Promise<ReportsOverviewResult> {
  const activeProject = project?.trim() || null;

  try {
    const client = getDashboardApiClient();
    const [projects, page] = await Promise.all([
      client.listProjects(),
      client.listReports({
        ...(activeProject ? { project: activeProject } : {}),
        limit: OVERVIEW_LIMIT,
      }),
    ]);

    return {
      status: "ok",
      projects: sortProjects(projects),
      reports: page.reports,
      summary: computeReportsSummary(page.reports),
      activeProject,
      now: Date.now(),
    };
  } catch (error) {
    if (error instanceof DashboardApiError) {
      return {
        status: "error",
        kind: error.code,
        message: FRIENDLY_MESSAGE[error.code],
      };
    }
    return {
      status: "error",
      kind: "config",
      message: FRIENDLY_MESSAGE.config,
    };
  }
}

function sortProjects(projects: DashboardProject[]): DashboardProject[] {
  return [...projects].sort((a, b) => {
    if (b.reportCount !== a.reportCount) {
      return b.reportCount - a.reportCount;
    }
    return a.name.localeCompare(b.name);
  });
}
