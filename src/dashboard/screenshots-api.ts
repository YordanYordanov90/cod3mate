import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  getQaArtifactPaths,
  isAllowedScreenshotFilename,
  resolveSafeArtifactPath,
  sanitizeReportId,
} from '../storage/qa-artifacts.js';
import type { DashboardScreenshot } from './report-contract.js';
import { getDashboardReportById } from './reports-api.js';

export const SCREENSHOT_CACHE_CONTROL = 'private, max-age=300';

export interface ScreenshotFilePayload {
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

export type ScreenshotServeError =
  | 'invalid_report'
  | 'invalid_extension'
  | 'traversal'
  | 'not_found';

export function screenshotContentType(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return null;
}

/** List screenshot metadata for a persisted report. Returns null when the report is unknown. */
export async function listReportScreenshots(
  dataDir: string,
  reportId: string
): Promise<DashboardScreenshot[] | null> {
  const report = await getDashboardReportById(dataDir, reportId);
  if (!report) return null;
  return report.screenshots;
}

/**
 * Read a durable screenshot binary from `/data/qa-artifacts/screenshots/`.
 * Rejects unknown reports, traversal, unsupported extensions, and missing files.
 */
export async function readDashboardScreenshot(
  dataDir: string,
  reportId: string,
  filename: string
): Promise<{ ok: true; file: ScreenshotFilePayload } | { ok: false; error: ScreenshotServeError }> {
  const report = await getDashboardReportById(dataDir, reportId);
  if (!report) {
    return { ok: false, error: 'invalid_report' };
  }

  const decoded = decodeURIComponent(filename).replace(/\\/g, '/');
  if (decoded.includes('..') || decoded.includes('/')) {
    return { ok: false, error: 'traversal' };
  }

  const base = path.basename(decoded);
  if (!isAllowedScreenshotFilename(base)) {
    return { ok: false, error: 'invalid_extension' };
  }

  let safeId: string;
  try {
    safeId = sanitizeReportId(reportId);
  } catch {
    return { ok: false, error: 'invalid_report' };
  }

  const { screenshotsRoot } = getQaArtifactPaths(dataDir);
  const reportDir = path.join(screenshotsRoot, safeId);

  let fullPath: string;
  try {
    fullPath = resolveSafeArtifactPath(base, reportDir);
  } catch {
    return { ok: false, error: 'traversal' };
  }

  if (!fullPath.startsWith(screenshotsRoot + path.sep)) {
    return { ok: false, error: 'traversal' };
  }

  const contentType = screenshotContentType(base);
  if (!contentType) {
    return { ok: false, error: 'invalid_extension' };
  }

  try {
    const body = await readFile(fullPath);
    return {
      ok: true,
      file: {
        body,
        contentType,
        cacheControl: SCREENSHOT_CACHE_CONTROL,
      },
    };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { ok: false, error: 'not_found' };
    }
    throw err;
  }
}
