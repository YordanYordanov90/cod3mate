import "server-only";

import { getDashboardApiClient } from "./api-client";
import { DashboardApiError } from "./api-client-core";
import type { DashboardApiErrorCode } from "./api-errors";
import type { DashboardReport } from "./api-contract";

export interface ReportDetailData {
  status: "ok";
  report: DashboardReport;
  now: number;
}

export interface ReportDetailNotFound {
  status: "not_found";
}

export interface ReportDetailError {
  status: "error";
  kind: Exclude<DashboardApiErrorCode, "not_found"> | "config";
  message: string;
}

export type ReportDetailResult =
  | ReportDetailData
  | ReportDetailNotFound
  | ReportDetailError;

const FRIENDLY_MESSAGE: Record<ReportDetailError["kind"], string> = {
  config:
    "The dashboard API connection is not configured. Set DASHBOARD_API_BASE_URL and DASHBOARD_API_TOKEN.",
  unavailable: "The Railway dashboard API is unreachable right now.",
  auth: "The dashboard API rejected the server token. Check DASHBOARD_API_TOKEN.",
  invalid_response: "The dashboard API returned an unexpected response.",
  unknown: "Something went wrong talking to the dashboard API.",
};

/**
 * Load a single report for the detail view.
 *
 * Never throws — a missing report becomes a typed `not_found` result, and
 * connection/auth/schema failures normalize into a typed error result so the
 * UI renders a calm state instead of crashing. The report already includes
 * screenshot metadata, so a single API call is enough.
 */
export async function loadReportDetail(
  id: string,
): Promise<ReportDetailResult> {
  try {
    const report = await getDashboardApiClient().getReport(id);
    return { status: "ok", report, now: Date.now() };
  } catch (error) {
    if (error instanceof DashboardApiError) {
      if (error.code === "not_found") {
        return { status: "not_found" };
      }
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

/** Server-side proxy URL for a private screenshot binary (token never leaves the server). */
export function screenshotProxyUrl(reportId: string, filename: string): string {
  return `/api/screenshots/${encodeURIComponent(reportId)}/${encodeURIComponent(filename)}`;
}
