import "server-only";

import { getRailwayApiEnv } from "./railway-api-env";
import {
  createDashboardApiClient,
  type DashboardApiClient,
  type DashboardApiClientConfig,
  type DashboardProject,
  type DashboardReport,
  type DashboardScreenshot,
  type DashboardTranscript,
  type ListReportsOptions,
  type ListReportsResult,
} from "./api-client-core";

export { DashboardApiError } from "./api-client-core";
export type {
  DashboardApiClient,
  DashboardApiClientConfig,
  DashboardProject,
  DashboardReport,
  DashboardScreenshot,
  DashboardTranscript,
  ListReportsOptions,
  ListReportsResult,
} from "./api-client-core";

export { createDashboardApiClient };

let defaultClient: DashboardApiClient | null = null;

export function getDashboardApiClient(
  overrides?: Partial<DashboardApiClientConfig>,
): DashboardApiClient {
  if (!overrides && defaultClient) {
    return defaultClient;
  }

  const env = getRailwayApiEnv();
  const client = createDashboardApiClient({
    baseUrl: overrides?.baseUrl ?? env.DASHBOARD_API_BASE_URL,
    token: overrides?.token ?? env.DASHBOARD_API_TOKEN,
    fetch: overrides?.fetch,
  });

  if (!overrides) {
    defaultClient = client;
  }

  return client;
}

export async function listProjects(
  overrides?: Partial<DashboardApiClientConfig>,
): Promise<DashboardProject[]> {
  return getDashboardApiClient(overrides).listProjects();
}

export async function listReports(
  options?: ListReportsOptions,
  overrides?: Partial<DashboardApiClientConfig>,
): Promise<ListReportsResult> {
  return getDashboardApiClient(overrides).listReports(options);
}

export async function getReport(
  id: string,
  overrides?: Partial<DashboardApiClientConfig>,
): Promise<DashboardReport> {
  return getDashboardApiClient(overrides).getReport(id);
}

export async function getReportScreenshots(
  id: string,
  overrides?: Partial<DashboardApiClientConfig>,
): Promise<DashboardScreenshot[]> {
  return getDashboardApiClient(overrides).getReportScreenshots(id);
}

export async function getReportTranscript(
  id: string,
  overrides?: Partial<DashboardApiClientConfig>,
): Promise<DashboardTranscript> {
  return getDashboardApiClient(overrides).getReportTranscript(id);
}
