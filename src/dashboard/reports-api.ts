import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { readJsonFile, getStoragePaths } from '../storage/mod.js';
import { loadQaReportById } from '../storage/qa-reports.js';
import { sanitizeObject } from '../security/sanitize.js';
import {
  normalizeStoredQaReport,
  parseStoredQaReportJson,
  type DashboardReport,
} from './report-contract.js';

export const DEFAULT_REPORTS_LIMIT = 20;
export const MAX_REPORTS_LIMIT = 100;

export interface DashboardProjectSummary {
  name: string;
  reportCount: number;
}

export interface ListDashboardReportsResult {
  reports: DashboardReport[];
  nextCursor: string | null;
}

export interface ListDashboardReportsOptions {
  project?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

interface ReportCandidate {
  mtime: number;
  report: DashboardReport;
}

function compareReportsDesc(a: DashboardReport, b: DashboardReport): number {
  const ta = Date.parse(a.startedAt) || 0;
  const tb = Date.parse(b.startedAt) || 0;
  if (tb !== ta) return tb - ta;
  return b.id.localeCompare(a.id);
}

/** Encode a pagination cursor from a report's sort key. */
export function encodeReportCursor(report: DashboardReport): string {
  return Buffer.from(`${report.startedAt}\x00${report.id}`).toString('base64url');
}

/** Decode a pagination cursor; returns null when invalid. */
export function decodeReportCursor(cursor: string): { startedAt: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.indexOf('\x00');
    if (sep <= 0) return null;
    const startedAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!startedAt || !id) return null;
    return { startedAt, id };
  } catch {
    return null;
  }
}

export function clampReportsLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit)) {
    return DEFAULT_REPORTS_LIMIT;
  }
  const rounded = Math.floor(limit);
  if (rounded < 1) return DEFAULT_REPORTS_LIMIT;
  return Math.min(rounded, MAX_REPORTS_LIMIT);
}

function sliceAfterCursor(
  reports: DashboardReport[],
  cursor: { startedAt: string; id: string }
): DashboardReport[] {
  const idx = reports.findIndex((r) => r.startedAt === cursor.startedAt && r.id === cursor.id);
  if (idx === -1) {
    return reports;
  }
  return reports.slice(idx + 1);
}

/**
 * Load every valid QA report from disk and normalize through the dashboard
 * contract. Corrupt or unparseable files are skipped silently.
 */
export async function loadDashboardReportsFromDisk(dataDir: string): Promise<DashboardReport[]> {
  const { qaReportsDir } = getStoragePaths(dataDir);
  let files: string[];
  try {
    files = await readdir(qaReportsDir);
  } catch {
    return [];
  }

  const candidates: ReportCandidate[] = [];

  for (const filename of files) {
    if (!filename.endsWith('.json')) continue;
    const fullPath = path.join(qaReportsDir, filename);
    const stem = filename.replace(/\.json$/, '');

    try {
      const st = await stat(fullPath);
      const raw = await readJsonFile<unknown>(fullPath);
      const parsed = parseStoredQaReportJson(raw, stem);
      if (!parsed) continue;

      const report = normalizeStoredQaReport(parsed);
      candidates.push({ mtime: st.mtimeMs, report });
    } catch {
      // ignore corrupt files
    }
  }

  candidates.sort((a, b) => {
    const byStarted = compareReportsDesc(a.report, b.report);
    if (byStarted !== 0) return byStarted;
    return b.mtime - a.mtime;
  });

  return candidates.map((c) => c.report);
}

export function filterReportsByProject(
  reports: DashboardReport[],
  project?: string
): DashboardReport[] {
  const needle = project?.trim();
  if (!needle) return reports;
  return reports.filter((r) => r.project === needle);
}

export function listDashboardProjects(reports: DashboardReport[]): DashboardProjectSummary[] {
  const counts = new Map<string, number>();
  for (const report of reports) {
    counts.set(report.project, (counts.get(report.project) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, reportCount]) => ({ name, reportCount }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listDashboardReports(
  reports: DashboardReport[],
  options: ListDashboardReportsOptions = {}
): ListDashboardReportsResult {
  const limit = clampReportsLimit(options.limit);
  let filtered = filterReportsByProject(reports, options.project);
  filtered = [...filtered].sort(compareReportsDesc);

  if (options.cursor) {
    const decoded = decodeReportCursor(options.cursor);
    if (decoded) {
      filtered = sliceAfterCursor(filtered, decoded);
    }
  }

  const page = filtered.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    page.length === limit && last && filtered.length > limit ? encodeReportCursor(last) : null;

  return { reports: page, nextCursor };
}

export async function getDashboardReportById(
  dataDir: string,
  reportId: string
): Promise<DashboardReport | null> {
  const stored = await loadQaReportById(dataDir, reportId);
  if (!stored) return null;

  const parsed = parseStoredQaReportJson(stored, stored.id);
  if (!parsed) return null;

  return normalizeStoredQaReport(parsed);
}

/** Deep-sanitize dashboard API payloads before they leave the process. */
export function sanitizeDashboardResponse<T>(payload: T): T {
  return sanitizeObject(payload);
}
