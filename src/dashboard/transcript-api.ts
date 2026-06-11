import { loadQaReportById } from '../storage/qa-reports.js';
import { loadQaTranscriptByReportId } from '../storage/qa-transcripts.js';
import { sanitizeString, sanitizeObject } from '../security/sanitize.js';
import {
  normalizeDashboardTranscript,
  type DashboardTranscript,
} from './transcript-contract.js';

export function sanitizeDashboardTranscript(
  transcript: DashboardTranscript
): DashboardTranscript {
  return {
    ...transcript,
    title: sanitizeString(transcript.title),
    ...(transcript.modelUsed ? { modelUsed: sanitizeString(transcript.modelUsed) } : {}),
    entries: transcript.entries.map((entry) => ({
      ...entry,
      ...(entry.content ? { content: sanitizeString(entry.content) } : {}),
      ...(entry.model ? { model: sanitizeString(entry.model) } : {}),
      ...(entry.toolName ? { toolName: sanitizeString(entry.toolName) } : {}),
      ...(entry.toolArgs
        ? { toolArgs: sanitizeObject(entry.toolArgs) as Record<string, unknown> }
        : {}),
      ...(entry.screenshotRef
        ? {
            screenshotRef: {
              filename: entry.screenshotRef.filename,
              path: entry.screenshotRef.path,
              ...(entry.screenshotRef.label
                ? { label: sanitizeString(entry.screenshotRef.label) }
                : {}),
            },
          }
        : {}),
    })),
  };
}

/**
 * Load transcript for a known report id. Returns null when report or transcript is missing.
 */
export async function getDashboardTranscriptByReportId(
  dataDir: string,
  reportId: string
): Promise<DashboardTranscript | null> {
  const report = await loadQaReportById(dataDir, reportId);
  if (!report) return null;

  const raw = await loadQaTranscriptByReportId(dataDir, report.id);
  if (!raw) return null;

  const normalized = normalizeDashboardTranscript(report.id, raw);
  return sanitizeDashboardTranscript(normalized);
}