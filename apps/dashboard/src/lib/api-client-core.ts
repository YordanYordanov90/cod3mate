import type { z } from "zod";
import {
  getReportResponseSchema,
  getReportScreenshotsResponseSchema,
  listProjectsResponseSchema,
  listReportsResponseSchema,
  type DashboardProject,
  type DashboardReport,
  type DashboardScreenshot,
} from "./api-contract";
import { DashboardApiError } from "./api-errors";

export { DashboardApiError } from "./api-errors";
export type {
  DashboardProject,
  DashboardReport,
  DashboardScreenshot,
} from "./api-contract";

type FetchFn = typeof fetch;

export interface DashboardApiClientConfig {
  baseUrl: string;
  token: string;
  fetch?: FetchFn;
}

export interface ListReportsOptions {
  project?: string;
  limit?: number;
  cursor?: string;
}

export interface ListReportsResult {
  reports: DashboardReport[];
  nextCursor: string | null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function buildReportsQuery(options: ListReportsOptions = {}): string {
  const params = new URLSearchParams();
  if (options.project) {
    params.set("project", options.project);
  }
  if (options.limit != null) {
    params.set("limit", String(options.limit));
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function requestJson<T>(
  fetchFn: FetchFn,
  url: string,
  token: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;

  try {
    response = await fetchFn(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (cause) {
    throw new DashboardApiError(
      "Railway dashboard API is unavailable",
      "unavailable",
      { cause },
    );
  }

  if (response.status === 401) {
    throw new DashboardApiError(
      "Railway dashboard API authentication failed",
      "auth",
      { status: 401 },
    );
  }

  if (response.status === 404) {
    throw new DashboardApiError("Resource not found", "not_found", {
      status: 404,
    });
  }

  if (!response.ok) {
    throw new DashboardApiError(
      `Railway dashboard API returned ${response.status}`,
      response.status >= 500 ? "unavailable" : "unknown",
      { status: response.status },
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (cause) {
    throw new DashboardApiError(
      "Railway dashboard API returned invalid JSON",
      "invalid_response",
      { status: response.status, cause },
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DashboardApiError(
      "Railway dashboard API returned an unexpected response shape",
      "invalid_response",
      { status: response.status, cause: parsed.error },
    );
  }

  return parsed.data;
}

export interface DashboardApiClient {
  listProjects(): Promise<DashboardProject[]>;
  listReports(options?: ListReportsOptions): Promise<ListReportsResult>;
  getReport(id: string): Promise<DashboardReport>;
  getReportScreenshots(id: string): Promise<DashboardScreenshot[]>;
}

export function createDashboardApiClient(
  config: DashboardApiClientConfig,
): DashboardApiClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const fetchFn = config.fetch ?? fetch;

  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return requestJson(fetchFn, `${baseUrl}${path}`, config.token, schema);
  }

  return {
    async listProjects() {
      const data = await get(
        "/api/dashboard/projects",
        listProjectsResponseSchema,
      );
      return data.projects;
    },

    async listReports(options = {}) {
      const data = await get(
        `/api/dashboard/reports${buildReportsQuery(options)}`,
        listReportsResponseSchema,
      );
      return {
        reports: data.reports,
        nextCursor: data.nextCursor,
      };
    },

    async getReport(id) {
      const data = await get(
        `/api/dashboard/reports/${encodeURIComponent(id)}`,
        getReportResponseSchema,
      );
      return data.report;
    },

    async getReportScreenshots(id) {
      const data = await get(
        `/api/dashboard/reports/${encodeURIComponent(id)}/screenshots`,
        getReportScreenshotsResponseSchema,
      );
      return data.screenshots;
    },
  };
}
