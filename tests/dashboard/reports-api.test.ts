import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  clampReportsLimit,
  decodeReportCursor,
  encodeReportCursor,
  filterReportsByProject,
  getDashboardReportById,
  listDashboardProjects,
  listDashboardReports,
  loadDashboardReportsFromDisk,
} from '../../src/dashboard/reports-api.js';
import { normalizeStoredQaReport } from '../../src/dashboard/report-contract.js';

async function writeReportFile(
  dataDir: string,
  filename: string,
  body: Record<string, unknown>
): Promise<void> {
  const dir = path.join(dataDir, 'qa-reports');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), JSON.stringify(body, null, 2), 'utf8');
}

describe('dashboard reports API (Milestone 5)', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-dash-reports-'));
    await mkdir(path.join(dataDir, 'qa-reports'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('loads and sorts reports newest first by startedAt', async () => {
    await writeReportFile(dataDir, 'older.json', {
      id: 'older',
      title: 'Older run',
      startedAt: '2026-05-01T10:00:00.000Z',
      entries: [{ name: 'a', status: 'pass' }],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    });
    await writeReportFile(dataDir, 'newer.json', {
      id: 'newer',
      title: 'Newer run',
      startedAt: '2026-06-01T12:00:00.000Z',
      entries: [{ name: 'b', status: 'fail' }],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
    });

    const reports = await loadDashboardReportsFromDisk(dataDir);
    expect(reports.map((r) => r.id)).toEqual(['newer', 'older']);
  });

  it('ignores corrupt report files safely', async () => {
    await writeReportFile(dataDir, 'good.json', {
      id: 'good',
      title: 'Good',
      startedAt: '2026-06-01T12:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });
    await writeFile(path.join(dataDir, 'qa-reports', 'bad.json'), '{not json', 'utf8');
    await writeReportFile(dataDir, 'missing-title.json', {
      startedAt: '2026-06-01T12:00:00.000Z',
      entries: [],
    });

    const reports = await loadDashboardReportsFromDisk(dataDir);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.id).toBe('good');
  });

  it('normalizes old reports without screenshots or project metadata', async () => {
    await writeReportFile(dataDir, 'legacy.json', {
      id: 'legacy',
      title: 'Legacy run',
      startedAt: '2026-05-01T10:00:00.000Z',
      endedAt: '2026-05-01T10:00:02.000Z',
      entries: [{ name: 'check', status: 'pass' }],
    });

    const reports = await loadDashboardReportsFromDisk(dataDir);
    expect(reports[0]).toMatchObject({
      id: 'legacy',
      project: 'unknown',
      screenshots: [],
      durationMs: 2000,
    });
  });

  it('filters reports by project', async () => {
    const example = normalizeStoredQaReport({
      id: 'ex-1',
      title: 'QA: https://app.example.com',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });
    const other = normalizeStoredQaReport({
      id: 'other-1',
      title: 'No URL here',
      startedAt: '2026-06-01T11:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });

    const filtered = filterReportsByProject([example, other], 'app.example.com');
    expect(filtered.map((r) => r.id)).toEqual(['ex-1']);
  });

  it('lists unique projects with counts', async () => {
    const a = normalizeStoredQaReport({
      id: 'a',
      title: 'QA: https://app.example.com/a',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });
    const b = normalizeStoredQaReport({
      id: 'b',
      title: 'QA: https://app.example.com/b',
      startedAt: '2026-06-01T11:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });
    const unknown = normalizeStoredQaReport({
      id: 'c',
      title: 'Plain title',
      startedAt: '2026-06-01T12:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });

    const projects = listDashboardProjects([a, b, unknown]);
    expect(projects).toEqual([
      { name: 'app.example.com', reportCount: 2 },
      { name: 'unknown', reportCount: 1 },
    ]);
  });

  it('paginates with limit and cursor', async () => {
    const reports = ['r1', 'r2', 'r3', 'r4'].map((id, i) =>
      normalizeStoredQaReport({
        id,
        title: id,
        startedAt: `2026-06-0${4 - i}T10:00:00.000Z`,
        entries: [],
        summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
      })
    );

    const first = listDashboardReports(reports, { limit: 2 });
    expect(first.reports.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(first.nextCursor).toBeTruthy();

    const second = listDashboardReports(reports, { limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.reports.map((r) => r.id)).toEqual(['r3', 'r4']);
    expect(second.nextCursor).toBeNull();
  });

  it('round-trips cursor encoding', () => {
    const report = normalizeStoredQaReport({
      id: 'cursor-id',
      title: 'Cursor',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });
    const cursor = encodeReportCursor(report);
    expect(decodeReportCursor(cursor)).toEqual({
      startedAt: '2026-06-01T10:00:00.000Z',
      id: 'cursor-id',
    });
    expect(decodeReportCursor('not-a-valid-cursor')).toBeNull();
  });

  it('clamps report list limits', () => {
    expect(clampReportsLimit(undefined)).toBe(20);
    expect(clampReportsLimit(0)).toBe(20);
    expect(clampReportsLimit(5)).toBe(5);
    expect(clampReportsLimit(500)).toBe(100);
  });

  it('loads a single report by id', async () => {
    await writeReportFile(dataDir, 'target-report.json', {
      id: 'target-report',
      title: 'Target',
      startedAt: '2026-06-01T10:00:00.000Z',
      entries: [{ name: 'ok', status: 'pass' }],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    });

    const found = await getDashboardReportById(dataDir, 'target-report');
    expect(found?.title).toBe('Target');

    const missing = await getDashboardReportById(dataDir, 'does-not-exist');
    expect(missing).toBeNull();
  });
});
