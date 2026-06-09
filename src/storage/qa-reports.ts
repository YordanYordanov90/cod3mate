import path from 'node:path';
import { readdir, stat, mkdir } from 'node:fs/promises';
import { readJsonFile, writeJsonFile, getStoragePaths } from './mod.js';
import type { QaReport } from '../tools/qa/report.js';
import {
  copyTmpScreenshotToDurable,
  ensureQaArtifactsDirs,
  type DurableScreenshotMeta,
} from './qa-artifacts.js';

export type { DurableScreenshotMeta };

export interface StoredQaReport extends QaReport {
  id: string;
  screenshots?: DurableScreenshotMeta[];
}

export interface SaveQaReportOptions {
  tmpDir?: string;
  tmpScreenshotPaths?: string[];
}

/**
 * Ensure the qa-reports dir exists (idempotent). Returns the full path.
 */
export async function ensureQaReportsDir(dataDir: string): Promise<string> {
  const paths = getStoragePaths(dataDir);
  // getStoragePaths now includes it; ensureDataDirectories will have created it,
  // but we mkdir defensively for direct use.
  await mkdir(paths.qaReportsDir, { recursive: true });
  return paths.qaReportsDir;
}

function buildReportId(report: QaReport): string {
  const baseTs = report.startedAt || new Date().toISOString();
  const ts = baseTs.replace(/[:.]/g, '-');
  const slug = (report.title || 'qa-run')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'run';
  return `${ts}-${slug}`;
}

async function persistDurableScreenshots(
  dataDir: string,
  reportId: string,
  tmpDir: string,
  tmpScreenshotPaths: string[]
): Promise<DurableScreenshotMeta[]> {
  await ensureQaArtifactsDirs(dataDir);
  const screenshots: DurableScreenshotMeta[] = [];
  const seen = new Set<string>();

  for (const rel of tmpScreenshotPaths) {
    const meta = await copyTmpScreenshotToDurable(dataDir, tmpDir, reportId, rel);
    if (!meta || seen.has(meta.path)) continue;
    seen.add(meta.path);
    screenshots.push(meta);
  }

  return screenshots;
}

/**
 * Save a completed QA report as JSON under /data/qa-reports/.
 * Filename: <iso-ts-slug>.json . Returns the generated id.
 *
 * When `options.tmpScreenshotPaths` is provided with `options.tmpDir`, copies
 * transient screenshots into `/data/qa-artifacts/screenshots/<reportId>/` and
 * stores metadata on the saved report JSON.
 */
export async function saveQaReport(
  dataDir: string,
  report: QaReport,
  options: SaveQaReportOptions = {}
): Promise<string> {
  const dir = await ensureQaReportsDir(dataDir);
  const id = buildReportId(report);
  const filePath = path.join(dir, `${id}.json`);
  const toStore: StoredQaReport = { ...report, id };

  const tmpDir = options.tmpDir;
  const tmpScreenshotPaths = options.tmpScreenshotPaths ?? [];
  if (tmpDir && tmpScreenshotPaths.length > 0) {
    const screenshots = await persistDurableScreenshots(dataDir, id, tmpDir, tmpScreenshotPaths);
    if (screenshots.length > 0) {
      toStore.screenshots = screenshots;
    }
  }

  await writeJsonFile(filePath, toStore);
  return id;
}

/**
 * List the most recent QA reports (by startedAt or file mtime), up to limit.
 * Returns lightweight summaries (no full entry details) for /qa-history.
 */
export async function listRecentQaReports(
  dataDir: string,
  limit = 10
): Promise<
  Array<{
    id: string;
    title: string;
    timestamp: string;
    total: number;
    passed: number;
    failed: number;
  }>
> {
  const dir = await ensureQaReportsDir(dataDir);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const candidates: Array<{ id: string; mtime: number; data: any }> = [];

  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(dir, f);
    try {
      const st = await stat(full);
      const data = await readJsonFile<StoredQaReport>(full);
      if (data && typeof data.title === 'string') {
        candidates.push({
          id: data.id || f.replace(/\.json$/, ''),
          mtime: st.mtimeMs,
          data,
        });
      }
    } catch {
      // ignore corrupt files
    }
  }

  // Sort newest first (prefer startedAt if parseable, else mtime)
  candidates.sort((a, b) => {
    const ta = Date.parse(a.data.startedAt || '') || a.mtime;
    const tb = Date.parse(b.data.startedAt || '') || b.mtime;
    return tb - ta;
  });

  return candidates.slice(0, limit).map((c) => {
    const s = c.data.summary || { total: c.data.entries?.length || 0, passed: 0, failed: 0 };
    return {
      id: c.id,
      title: c.data.title,
      timestamp: c.data.startedAt || new Date(c.mtime).toISOString(),
      total: s.total ?? (c.data.entries?.length || 0),
      passed: s.passed ?? 0,
      failed: s.failed ?? 0,
    };
  });
}

/**
 * Load a persisted QA report by id (filename stem or stored id field).
 * Returns null if not found or corrupt.
 */
export async function loadQaReportById(
  dataDir: string,
  reportId: string
): Promise<StoredQaReport | null> {
  const safeId = reportId.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeId) return null;

  const dir = await ensureQaReportsDir(dataDir);
  const direct = path.join(dir, `${safeId}.json`);
  try {
    const data = await readJsonFile<StoredQaReport>(direct);
    if (data && typeof data.title === 'string') {
      return { ...data, id: data.id || safeId };
    }
  } catch {
    // fall through to scan
  }

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const stem = f.replace(/\.json$/, '');
    try {
      const data = await readJsonFile<StoredQaReport>(path.join(dir, f));
      if (data && typeof data.title === 'string' && (data.id === safeId || stem === safeId)) {
        return { ...data, id: data.id || stem };
      }
    } catch {
      // ignore
    }
  }

  return null;
}
