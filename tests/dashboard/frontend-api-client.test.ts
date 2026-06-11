import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createDashboardApiClient,
  DashboardApiError,
} from "../../apps/dashboard/src/lib/api-client-core.ts";

const BASE_URL = "https://railway.example.com";
const TOKEN = "test-dashboard-token-0123456789";

const sampleReport = {
  id: "report-1",
  title: "Login flow",
  project: "example.com",
  startedAt: "2026-06-01T12:00:00.000Z",
  endedAt: "2026-06-01T12:01:00.000Z",
  durationMs: 60_000,
  summary: { total: 2, passed: 1, failed: 1, skipped: 0 },
  entries: [
    { name: "Dashboard visible", status: "pass" as const },
    { name: "Submit works", status: "fail" as const, details: "Button missing" },
  ],
  screenshots: [{ filename: "step-1.png", label: "After login" }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createClient(fetchImpl: typeof fetch) {
  return createDashboardApiClient({
    baseUrl: BASE_URL,
    token: TOKEN,
    fetch: fetchImpl,
  });
}

describe("dashboard frontend API client (Milestone 9)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listProjects sends bearer auth and validates the response", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`${BASE_URL}/api/dashboard/projects`);
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
      });
      return jsonResponse({
        ok: true,
        projects: [{ name: "example.com", reportCount: 3 }],
      });
    });

    const projects = await createClient(fetchMock).listProjects();
    expect(projects).toEqual([{ name: "example.com", reportCount: 3 }]);
  });

  it("listReports forwards query params and returns pagination cursor", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(
        `${BASE_URL}/api/dashboard/reports?project=example.com&limit=10&cursor=abc`,
      );
      return jsonResponse({
        ok: true,
        reports: [sampleReport],
        nextCursor: "next-page",
      });
    });

    const result = await createClient(fetchMock).listReports({
      project: "example.com",
      limit: 10,
      cursor: "abc",
    });

    expect(result.reports).toHaveLength(1);
    expect(result.nextCursor).toBe("next-page");
  });

  it("getReport fetches a single report by id", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${BASE_URL}/api/dashboard/reports/report-1`);
      return jsonResponse({ ok: true, report: sampleReport });
    });

    const report = await createClient(fetchMock).getReport("report-1");
    expect(report.id).toBe("report-1");
    expect(report.project).toBe("example.com");
  });

  it("getReportScreenshots fetches screenshot metadata", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(
        `${BASE_URL}/api/dashboard/reports/report-1/screenshots`,
      );
      return jsonResponse({
        ok: true,
        screenshots: [{ filename: "step-1.png", label: "After login" }],
      });
    });

    const screenshots = await createClient(fetchMock).getReportScreenshots(
      "report-1",
    );
    expect(screenshots).toEqual([
      { filename: "step-1.png", label: "After login" },
    ]);
  });

  it("throws auth error when Railway returns 401", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, error: "Unauthorized" }, 401));

    await expect(createClient(fetchMock).listProjects()).rejects.toMatchObject({
      name: "DashboardApiError",
      code: "auth",
      status: 401,
    } satisfies Partial<DashboardApiError>);
  });

  it("throws not_found when Railway returns 404", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, error: "Not found" }, 404));

    await expect(createClient(fetchMock).getReport("missing")).rejects.toMatchObject({
      name: "DashboardApiError",
      code: "not_found",
      status: 404,
    } satisfies Partial<DashboardApiError>);
  });

  it("throws unavailable when fetch fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(createClient(fetchMock).listProjects()).rejects.toMatchObject({
      name: "DashboardApiError",
      code: "unavailable",
    } satisfies Partial<DashboardApiError>);
  });

  it("throws unavailable when Railway returns 503", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false }, 503));

    await expect(createClient(fetchMock).listProjects()).rejects.toMatchObject({
      name: "DashboardApiError",
      code: "unavailable",
      status: 503,
    } satisfies Partial<DashboardApiError>);
  });

  it("getReportTranscript sends bearer auth and validates the response", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        `${BASE_URL}/api/dashboard/reports/report-1/transcript`,
      );
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${TOKEN}`,
      });
      return jsonResponse({
        ok: true,
        transcript: {
          reportId: "report-1",
          title: "Login flow",
          startedAt: "2026-06-01T12:00:00.000Z",
          entries: [
            {
              sequence: 1,
              timestamp: "2026-06-01T12:00:01.000Z",
              kind: "model_message",
              content: "Checking login page",
            },
          ],
        },
      });
    });

    const transcript = await createClient(fetchMock).getReportTranscript("report-1");
    expect(transcript.reportId).toBe("report-1");
    expect(transcript.entries).toHaveLength(1);
  });

  it("throws invalid_response when the JSON shape does not match the contract", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        ok: true,
        projects: [{ name: "example.com", reportCount: "not-a-number" }],
      }),
    );

    await expect(createClient(fetchMock).listProjects()).rejects.toMatchObject({
      name: "DashboardApiError",
      code: "invalid_response",
    } satisfies Partial<DashboardApiError>);
  });
});
