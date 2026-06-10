import { z } from 'zod';
import type { QaReportEntry, QaReportSummary } from '../tools/qa/report.js';
import type { StoredQaReport } from '../storage/qa-reports.js';
import type { DurableScreenshotMeta } from '../storage/qa-artifacts.js';

const HTTP_URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export const dashboardReportEntrySchema = z.object({
  name: z.string(),
  status: z.enum(['pass', 'fail', 'skip']),
  durationMs: z.number().int().nonnegative().optional(),
  details: z.string().optional(),
});

export const dashboardReportSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const dashboardScreenshotSchema = z.object({
  filename: z.string(),
  label: z.string().optional(),
});

export const dashboardReportSchema = z.object({
  id: z.string(),
  title: z.string(),
  project: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  summary: dashboardReportSummarySchema,
  entries: z.array(dashboardReportEntrySchema),
  screenshots: z.array(dashboardScreenshotSchema),
});

export type DashboardReportEntry = z.infer<typeof dashboardReportEntrySchema>;
export type DashboardReportSummary = z.infer<typeof dashboardReportSummarySchema>;
export type DashboardScreenshot = z.infer<typeof dashboardScreenshotSchema>;
export type DashboardReport = z.infer<typeof dashboardReportSchema>;

/** Lenient ingest schema for JSON on disk (old + future report shapes). */
const storedQaReportEntrySchema = z.object({
  name: z.string(),
  status: z.enum(['pass', 'fail', 'skip']),
  duration: z.number().optional(),
  details: z.string().optional(),
});

const storedQaReportInputSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  entries: z.array(storedQaReportEntrySchema).default([]),
  summary: dashboardReportSummarySchema.optional(),
  project: z.string().optional(),
  targetUrl: z.string().optional(),
  screenshots: z
    .array(
      z.object({
        filename: z.string().optional(),
        label: z.string().optional(),
        path: z.string().optional(),
      })
    )
    .optional(),
});

export type StoredQaReportInput = z.infer<typeof storedQaReportInputSchema>;

export interface StoredQaReportExtras {
  project?: string;
  targetUrl?: string;
}

export type StoredQaReportWithExtras = StoredQaReport & StoredQaReportExtras;

function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[.,;:!?)]+$/g, '');
}

/** Extract http(s) URLs from free text (titles, assertion details, etc.). */
export function extractHttpUrls(text: string): string[] {
  const matches = text.match(HTTP_URL_RE);
  if (!matches) return [];
  return matches.map(trimTrailingUrlPunctuation);
}

/** Normalize a URL hostname into a dashboard project key. */
export function projectFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    return host || null;
  } catch {
    return null;
  }
}

function firstProjectFromUrls(urls: string[]): string | null {
  for (const url of urls) {
    const project = projectFromUrl(url);
    if (project) return project;
  }
  return null;
}

function collectReportTextSources(report: StoredQaReportWithExtras): string[] {
  const parts = [report.title];
  if (report.targetUrl) {
    parts.push(report.targetUrl);
  }
  for (const entry of report.entries) {
    if (entry.details) {
      parts.push(entry.details);
    }
    parts.push(entry.name);
  }
  return parts;
}

/**
 * Infer dashboard project grouping from stored report content.
 * Priority: explicit project → targetUrl → URLs in title/entries → `unknown`.
 */
export function inferProjectFromStoredReport(report: StoredQaReportWithExtras): string {
  const explicit = report.project?.trim();
  if (explicit) {
    return explicit;
  }

  if (report.targetUrl) {
    const fromTarget = projectFromUrl(report.targetUrl);
    if (fromTarget) return fromTarget;
  }

  const urls: string[] = [];
  for (const text of collectReportTextSources(report)) {
    urls.push(...extractHttpUrls(text));
  }

  const inferred = firstProjectFromUrls(urls);
  return inferred ?? 'unknown';
}

function computeSummary(
  entries: QaReportEntry[],
  existing?: QaReportSummary
): DashboardReportSummary {
  if (existing) {
    return existing;
  }
  return {
    total: entries.length,
    passed: entries.filter((e) => e.status === 'pass').length,
    failed: entries.filter((e) => e.status === 'fail').length,
    skipped: entries.filter((e) => e.status === 'skip').length,
  };
}

function computeDurationMs(startedAt: string, endedAt?: string): number | undefined {
  if (!endedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return undefined;
  }
  return end - start;
}

function normalizeEntries(entries: QaReportEntry[]): DashboardReportEntry[] {
  return entries.map((entry) => {
    const normalized: DashboardReportEntry = {
      name: entry.name,
      status: entry.status,
    };
    if (typeof entry.duration === 'number' && entry.duration >= 0) {
      normalized.durationMs = Math.round(entry.duration);
    }
    if (entry.details) {
      normalized.details = entry.details;
    }
    return normalized;
  });
}

function normalizeScreenshots(report: StoredQaReportWithExtras): DashboardScreenshot[] {
  if (!report.screenshots?.length) {
    return [];
  }

  const out: DashboardScreenshot[] = [];
  for (const shot of report.screenshots) {
    const filename = shot.filename?.trim() || basenameFromPath(shot.path);
    if (!filename) continue;
    const item: DashboardScreenshot = { filename };
    if (shot.label?.trim()) {
      item.label = shot.label.trim();
    }
    out.push(item);
  }
  return out;
}

function basenameFromPath(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop();
  return base?.trim() || undefined;
}

/** Parse persisted QA report JSON from disk; returns null when invalid. */
export function parseStoredQaReportJson(
  raw: unknown,
  fallbackId?: string
): StoredQaReportWithExtras | null {
  const parsed = storedQaReportInputSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const data = parsed.data;
  const id = data.id?.trim() || fallbackId?.trim();
  if (!id) {
    return null;
  }

  const entries: QaReportEntry[] = data.entries.map((entry) => {
    const normalized: QaReportEntry = {
      name: entry.name,
      status: entry.status,
    };
    if (typeof entry.duration === 'number') {
      normalized.duration = entry.duration;
    }
    if (entry.details) {
      normalized.details = entry.details;
    }
    return normalized;
  });

  const report: StoredQaReportWithExtras = {
    id,
    title: data.title,
    startedAt: data.startedAt,
    entries,
    summary: data.summary ?? computeSummary(entries),
  };

  if (data.endedAt) {
    report.endedAt = data.endedAt;
  }
  if (data.project) {
    report.project = data.project;
  }
  if (data.targetUrl) {
    report.targetUrl = data.targetUrl;
  }
  if (data.screenshots) {
    const screenshots: DurableScreenshotMeta[] = [];
    for (const shot of data.screenshots) {
      const filename = shot.filename?.trim() || basenameFromPath(shot.path);
      const durablePath = shot.path?.trim() || (filename ? `${id}/${filename}` : undefined);
      if (!filename || !durablePath) continue;
      const item: DurableScreenshotMeta = { filename, path: durablePath };
      if (shot.label?.trim()) {
        item.label = shot.label.trim();
      }
      screenshots.push(item);
    }
    if (screenshots.length > 0) {
      report.screenshots = screenshots;
    }
  }

  return report;
}

/** Normalize a stored QA report into the dashboard read model. */
export function normalizeStoredQaReport(report: StoredQaReportWithExtras): DashboardReport {
  const entries = report.entries ?? [];
  const endedAt = report.endedAt;
  const normalized: DashboardReport = {
    id: report.id,
    title: report.title,
    project: inferProjectFromStoredReport(report),
    startedAt: report.startedAt,
    summary: computeSummary(entries, report.summary),
    entries: normalizeEntries(entries),
    screenshots: normalizeScreenshots(report),
  };

  if (endedAt) {
    normalized.endedAt = endedAt;
    const durationMs = computeDurationMs(report.startedAt, endedAt);
    if (durationMs != null) {
      normalized.durationMs = durationMs;
    }
  }

  return dashboardReportSchema.parse(normalized);
}
