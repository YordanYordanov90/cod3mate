import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  listReportScreenshots,
  readDashboardScreenshot,
  screenshotContentType,
  SCREENSHOT_CACHE_CONTROL,
} from '../../src/dashboard/screenshots-api.js';
import { resolveDurableScreenshotPath } from '../../src/storage/qa-artifacts.js';

const REPORT_ID = '2026-06-01T12-00-00-000Z-login-flow';

async function writeReportFile(
  dataDir: string,
  body: Record<string, unknown>
): Promise<void> {
  const dir = path.join(dataDir, 'qa-reports');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${REPORT_ID}.json`), JSON.stringify(body, null, 2), 'utf8');
}

async function writeScreenshot(
  dataDir: string,
  reportId: string,
  filename: string,
  content: string | Buffer
): Promise<void> {
  const { fullPath, reportDir } = resolveDurableScreenshotPath(dataDir, reportId, filename);
  await mkdir(reportDir, { recursive: true });
  await writeFile(fullPath, content);
}

describe('dashboard screenshots API (Milestone 6)', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-dash-shots-'));
    await mkdir(path.join(dataDir, 'qa-reports'), { recursive: true });
    await mkdir(path.join(dataDir, 'qa-artifacts', 'screenshots'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('maps supported screenshot extensions to image content types', () => {
    expect(screenshotContentType('step.png')).toBe('image/png');
    expect(screenshotContentType('photo.JPG')).toBe('image/jpeg');
    expect(screenshotContentType('photo.jpeg')).toBe('image/jpeg');
    expect(screenshotContentType('animation.gif')).toBeNull();
  });

  it('lists screenshot metadata for a known report', async () => {
    await writeReportFile(dataDir, {
      id: REPORT_ID,
      title: 'Login flow',
      startedAt: '2026-06-01T12:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
      screenshots: [{ filename: 'step-1.png', label: 'Login page' }],
    });

    const screenshots = await listReportScreenshots(dataDir, REPORT_ID);
    expect(screenshots).toEqual([{ filename: 'step-1.png', label: 'Login page' }]);
  });

  it('returns null when listing screenshots for an unknown report', async () => {
    expect(await listReportScreenshots(dataDir, 'missing-report')).toBeNull();
  });

  it('reads a valid screenshot with safe headers metadata', async () => {
    await writeReportFile(dataDir, {
      id: REPORT_ID,
      title: 'Login flow',
      startedAt: '2026-06-01T12:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });
    await writeScreenshot(dataDir, REPORT_ID, 'step-1.png', 'fake-png-bytes');

    const result = await readDashboardScreenshot(dataDir, REPORT_ID, 'step-1.png');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.body.toString()).toBe('fake-png-bytes');
      expect(result.file.contentType).toBe('image/png');
      expect(result.file.cacheControl).toBe(SCREENSHOT_CACHE_CONTROL);
    }
  });

  it('rejects unknown report ids', async () => {
    const result = await readDashboardScreenshot(dataDir, 'missing-report', 'step-1.png');
    expect(result).toEqual({ ok: false, error: 'invalid_report' });
  });

  it('rejects missing screenshot files', async () => {
    await writeReportFile(dataDir, {
      id: REPORT_ID,
      title: 'Login flow',
      startedAt: '2026-06-01T12:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });

    const result = await readDashboardScreenshot(dataDir, REPORT_ID, 'missing.png');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('rejects unsupported extensions', async () => {
    await writeReportFile(dataDir, {
      id: REPORT_ID,
      title: 'Login flow',
      startedAt: '2026-06-01T12:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });

    const result = await readDashboardScreenshot(dataDir, REPORT_ID, 'evil.gif');
    expect(result).toEqual({ ok: false, error: 'invalid_extension' });
  });

  it('rejects traversal attempts in filenames', async () => {
    await writeReportFile(dataDir, {
      id: REPORT_ID,
      title: 'Login flow',
      startedAt: '2026-06-01T12:00:00.000Z',
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });

    const result = await readDashboardScreenshot(dataDir, REPORT_ID, '../other.png');
    expect(result).toEqual({ ok: false, error: 'traversal' });
  });
});
