import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  DASHBOARD_SERVICE_NAME,
  routeDashboardRequest,
  startDashboardServer,
  type DashboardRouteResult,
  type DashboardServerHandle,
} from '../../src/dashboard/server.js';
import { resolveDurableScreenshotPath } from '../../src/storage/qa-artifacts.js';

const TOKEN = 'test-dashboard-token-0123456789';
const REPORT_ID = 'http-report';

function makeReq(
  url: string,
  headers: Record<string, string> = {},
  method = 'GET'
) {
  return { method, url, headers };
}

function authHeaders() {
  return { authorization: `Bearer ${TOKEN}` };
}

function ctx(dataDir: string) {
  return { token: TOKEN, dataDir };
}

function expectJson(result: DashboardRouteResult) {
  expect(result.kind).toBe('json');
  if (result.kind !== 'json') {
    throw new Error('expected json route result');
  }
  return result;
}

async function writeReportFile(
  dataDir: string,
  filename: string,
  body: Record<string, unknown>
): Promise<void> {
  const dir = path.join(dataDir, 'qa-reports');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), JSON.stringify(body, null, 2), 'utf8');
}

async function writeScreenshot(
  dataDir: string,
  reportId: string,
  filename: string,
  content: string
): Promise<void> {
  const { fullPath, reportDir } = resolveDurableScreenshotPath(dataDir, reportId, filename);
  await mkdir(reportDir, { recursive: true });
  await writeFile(fullPath, content);
}

describe('routeDashboardRequest (Milestone 4 + 5 + 6)', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-dash-server-'));
    await mkdir(path.join(dataDir, 'qa-reports'), { recursive: true });
    await mkdir(path.join(dataDir, 'qa-artifacts', 'screenshots'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('serves /health without authentication', async () => {
    const result = expectJson(await routeDashboardRequest(makeReq('/health'), ctx(dataDir)));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, service: DASHBOARD_SERVICE_NAME });
  });

  it('rejects /api/dashboard/health when the bearer token is missing', async () => {
    const result = expectJson(await routeDashboardRequest(makeReq('/api/dashboard/health'), ctx(dataDir)));
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ ok: false, error: 'Unauthorized' });
  });

  it('rejects /api/dashboard/health when the bearer token is invalid', async () => {
    const result = expectJson(
      await routeDashboardRequest(
        makeReq('/api/dashboard/health', { authorization: 'Bearer wrong-token-9999999999' }),
        ctx(dataDir)
      )
    );
    expect(result.status).toBe(401);
  });

  it('rejects a token of a different length without throwing', async () => {
    const result = expectJson(
      await routeDashboardRequest(
        makeReq('/api/dashboard/health', { authorization: 'Bearer short' }),
        ctx(dataDir)
      )
    );
    expect(result.status).toBe(401);
  });

  it('accepts /api/dashboard/health with a valid bearer token', async () => {
    const result = expectJson(
      await routeDashboardRequest(makeReq('/api/dashboard/health', authHeaders()), ctx(dataDir))
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, service: DASHBOARD_SERVICE_NAME });
  });

  it('requires auth for /api/dashboard/projects', async () => {
    const unauthorized = expectJson(
      await routeDashboardRequest(makeReq('/api/dashboard/projects'), ctx(dataDir))
    );
    expect(unauthorized.status).toBe(401);

    const authorized = expectJson(
      await routeDashboardRequest(makeReq('/api/dashboard/projects', authHeaders()), ctx(dataDir))
    );
    expect(authorized.status).toBe(200);
    expect(authorized.body).toMatchObject({ ok: true, projects: [] });
  });

  it('lists normalized reports with project filter and limit', async () => {
    await writeReportFile(dataDir, 'alpha.json', {
      id: 'alpha',
      title: 'QA: https://app.example.com/alpha',
      startedAt: '2026-06-02T10:00:00.000Z',
      entries: [{ name: 'pass', status: 'pass' }],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    });
    await writeReportFile(dataDir, 'beta.json', {
      id: 'beta',
      title: 'Plain title',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [{ name: 'fail', status: 'fail' }],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
    });

    const all = expectJson(
      await routeDashboardRequest(makeReq('/api/dashboard/reports?limit=10', authHeaders()), ctx(dataDir))
    );
    expect(all.status).toBe(200);
    expect(all.body.ok).toBe(true);
    expect((all.body.reports as unknown[]).length).toBe(2);

    const filtered = expectJson(
      await routeDashboardRequest(
        makeReq('/api/dashboard/reports?project=app.example.com', authHeaders()),
        ctx(dataDir)
      )
    );
    expect((filtered.body.reports as Array<{ id: string }>).map((r) => r.id)).toEqual(['alpha']);
  });

  it('returns report detail by id and 404 when missing', async () => {
    await writeReportFile(dataDir, 'detail.json', {
      id: 'detail',
      title: 'Detail report',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });

    const found = expectJson(
      await routeDashboardRequest(makeReq('/api/dashboard/reports/detail', authHeaders()), ctx(dataDir))
    );
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ ok: true, report: { id: 'detail', title: 'Detail report' } });

    const missing = expectJson(
      await routeDashboardRequest(makeReq('/api/dashboard/reports/missing-id', authHeaders()), ctx(dataDir))
    );
    expect(missing.status).toBe(404);
  });

  it('lists report screenshots for a known report', async () => {
    await writeReportFile(dataDir, `${REPORT_ID}.json`, {
      id: REPORT_ID,
      title: 'HTTP report',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
      screenshots: [{ filename: 'step-1.png', label: 'Login page' }],
    });

    const result = expectJson(
      await routeDashboardRequest(
        makeReq(`/api/dashboard/reports/${REPORT_ID}/screenshots`, authHeaders()),
        ctx(dataDir)
      )
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      screenshots: [{ filename: 'step-1.png', label: 'Login page' }],
    });
  });

  it('requires auth for screenshot routes', async () => {
    await writeReportFile(dataDir, `${REPORT_ID}.json`, {
      id: REPORT_ID,
      title: 'HTTP report',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });
    await writeScreenshot(dataDir, REPORT_ID, 'step-1.png', 'png-bytes');

    const list = expectJson(
      await routeDashboardRequest(makeReq(`/api/dashboard/reports/${REPORT_ID}/screenshots`), ctx(dataDir))
    );
    expect(list.status).toBe(401);

    const binary = expectJson(
      await routeDashboardRequest(
        makeReq(`/api/dashboard/screenshots/${REPORT_ID}/step-1.png`),
        ctx(dataDir)
      )
    );
    expect(binary.status).toBe(401);
  });

  it('serves screenshot binaries with image headers', async () => {
    await writeReportFile(dataDir, `${REPORT_ID}.json`, {
      id: REPORT_ID,
      title: 'HTTP report',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });
    await writeScreenshot(dataDir, REPORT_ID, 'step-1.png', 'png-bytes');

    const result = await routeDashboardRequest(
      makeReq(`/api/dashboard/screenshots/${REPORT_ID}/step-1.png`, authHeaders()),
      ctx(dataDir)
    );
    expect(result.kind).toBe('binary');
    if (result.kind === 'binary') {
      expect(result.status).toBe(200);
      expect(result.headers['Content-Type']).toBe('image/png');
      expect(result.headers['Cache-Control']).toBe('private, max-age=300');
      expect(result.body.toString()).toBe('png-bytes');
    }
  });

  it('returns 404 for missing screenshot files', async () => {
    await writeReportFile(dataDir, `${REPORT_ID}.json`, {
      id: REPORT_ID,
      title: 'HTTP report',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });

    const result = expectJson(
      await routeDashboardRequest(
        makeReq(`/api/dashboard/screenshots/${REPORT_ID}/missing.png`, authHeaders()),
        ctx(dataDir)
      )
    );
    expect(result.status).toBe(404);
  });

  it('returns 400 for invalid screenshot extensions', async () => {
    await writeReportFile(dataDir, `${REPORT_ID}.json`, {
      id: REPORT_ID,
      title: 'HTTP report',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });

    const result = expectJson(
      await routeDashboardRequest(
        makeReq(`/api/dashboard/screenshots/${REPORT_ID}/evil.gif`, authHeaders()),
        ctx(dataDir)
      )
    );
    expect(result.status).toBe(400);
  });

  it('returns 404 for unknown authenticated routes', async () => {
    const result = expectJson(
      await routeDashboardRequest(makeReq('/api/dashboard/unknown', authHeaders()), ctx(dataDir))
    );
    expect(result.status).toBe(404);
  });

  it('returns 404 for unknown public routes', async () => {
    const result = expectJson(await routeDashboardRequest(makeReq('/'), ctx(dataDir)));
    expect(result.status).toBe(404);
  });

  it('rejects non-GET methods', async () => {
    const result = expectJson(await routeDashboardRequest(makeReq('/health', {}, 'POST'), ctx(dataDir)));
    expect(result.status).toBe(405);
  });

  it('ignores query strings when matching health routes', async () => {
    const result = expectJson(await routeDashboardRequest(makeReq('/health?probe=1'), ctx(dataDir)));
    expect(result.status).toBe(200);
  });
});

describe('startDashboardServer (integration)', () => {
  let handle: DashboardServerHandle | undefined;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-dash-http-'));
    await mkdir(path.join(dataDir, 'qa-reports'), { recursive: true });
    await mkdir(path.join(dataDir, 'qa-artifacts', 'screenshots'), { recursive: true });
  });

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  it('binds a port and serves health, report, and screenshot endpoints over HTTP', async () => {
    const realisticReportId = '2026-06-10T15-30-00-000Z-pine-forge-vercel-app';

    await writeReportFile(dataDir, `${realisticReportId}.json`, {
      id: realisticReportId,
      title: 'HTTP report',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
      screenshots: [{ filename: 'step-1.png' }],
    });
    await writeScreenshot(dataDir, realisticReportId, 'step-1.png', 'png-bytes');

    handle = await startDashboardServer({
      token: TOKEN,
      dataDir,
      port: 0,
      logger: { log() {}, error() {} },
    });
    const base = `http://127.0.0.1:${handle.port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });

    const unauthorized = await fetch(`${base}/api/dashboard/reports`);
    expect(unauthorized.status).toBe(401);

    const reports = await fetch(`${base}/api/dashboard/reports`, {
      headers: authHeaders(),
    });
    expect(reports.status).toBe(200);
    const reportsBody = await reports.json();
    expect(reportsBody.reports).toHaveLength(1);
    expect(reportsBody.reports[0].id).toBe(realisticReportId);

    const detail = await fetch(
      `${base}/api/dashboard/reports/${encodeURIComponent(realisticReportId)}`,
      {
        headers: authHeaders(),
      }
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      ok: true,
      report: { id: realisticReportId, title: 'HTTP report' },
    });

    const screenshots = await fetch(
      `${base}/api/dashboard/reports/${encodeURIComponent(realisticReportId)}/screenshots`,
      {
        headers: authHeaders(),
      }
    );
    expect(screenshots.status).toBe(200);
    expect(await screenshots.json()).toMatchObject({
      ok: true,
      screenshots: [{ filename: 'step-1.png' }],
    });

    const image = await fetch(
      `${base}/api/dashboard/screenshots/${encodeURIComponent(realisticReportId)}/step-1.png`,
      {
        headers: authHeaders(),
      }
    );
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('cache-control')).toBe('private, max-age=300');
    expect(await image.text()).toBe('png-bytes');
  });

  it('serves transcript endpoint when transcript file exists', async () => {
    await writeReportFile(dataDir, `${REPORT_ID}.json`, {
      id: REPORT_ID,
      title: 'HTTP report',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [{ name: 'check', status: 'pass' }],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    });

    const transcriptDir = path.join(dataDir, 'qa-transcripts');
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(
      path.join(transcriptDir, `${REPORT_ID}.json`),
      JSON.stringify(
        {
          reportId: REPORT_ID,
          title: 'HTTP report',
          startedAt: '2026-06-01T10:00:00.000Z',
          entries: [
            {
              sequence: 1,
              timestamp: '2026-06-01T10:00:01.000Z',
              kind: 'model_message',
              content: 'Done',
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    handle = await startDashboardServer({
      token: TOKEN,
      dataDir,
      port: 0,
      logger: { log() {}, error() {} },
    });
    const base = `http://127.0.0.1:${handle.port}`;

    const transcript = await fetch(`${base}/api/dashboard/reports/${REPORT_ID}/transcript`, {
      headers: authHeaders(),
    });
    expect(transcript.status).toBe(200);
    expect(await transcript.json()).toMatchObject({
      ok: true,
      transcript: { reportId: REPORT_ID, entries: [{ kind: 'model_message' }] },
    });
  });

  it('stops accepting connections after close', async () => {
    const local = await startDashboardServer({
      token: TOKEN,
      dataDir,
      port: 0,
      logger: { log() {}, error() {} },
    });
    const base = `http://127.0.0.1:${local.port}`;
    await local.close();

    await expect(fetch(`${base}/health`)).rejects.toThrow();
  });
});
