import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readJsonFile, writeJsonFile, getStoragePaths } from './mod.js';
import { loadQaReportById } from './qa-reports.js';
import type { QaTranscript } from '../tools/qa/transcript.js';
import { linkTranscriptScreenshotRefs } from '../tools/qa/transcript.js';
import { sanitizeObject, sanitizeString } from '../security/sanitize.js';

export const QA_TRANSCRIPTS_DIR = 'qa-transcripts';

export async function ensureQaTranscriptsDir(dataDir: string): Promise<string> {
  const paths = getStoragePaths(dataDir);
  const dir = path.join(paths.dataDir, QA_TRANSCRIPTS_DIR);
  await mkdir(dir, { recursive: true });
  return dir;
}

function sanitizeTranscript(transcript: QaTranscript): QaTranscript {
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
 * Persist a sanitized QA run transcript linked to a saved report id.
 */
export async function saveQaTranscript(
  dataDir: string,
  reportId: string,
  transcript: QaTranscript
): Promise<void> {
  const safeId = reportId.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeId) {
    throw new Error('Invalid report id for transcript persistence');
  }

  const report = await loadQaReportById(dataDir, safeId);
  let linked = transcript;
  if (report?.screenshots?.length) {
    linked = linkTranscriptScreenshotRefs(transcript, report.screenshots);
  }

  const payload: QaTranscript = sanitizeTranscript({
    ...linked,
    reportId: safeId,
  });

  const dir = await ensureQaTranscriptsDir(dataDir);
  const filePath = path.join(dir, `${safeId}.json`);
  await writeJsonFile(filePath, payload);
}

/**
 * Load a persisted transcript for a report. Returns null if missing.
 */
export async function loadQaTranscriptByReportId(
  dataDir: string,
  reportId: string
): Promise<QaTranscript | null> {
  const safeId = reportId.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeId) return null;

  const dir = await ensureQaTranscriptsDir(dataDir);
  const filePath = path.join(dir, `${safeId}.json`);
  const data = await readJsonFile<QaTranscript>(filePath);
  if (!data || !Array.isArray(data.entries)) return null;
  return sanitizeTranscript({ ...data, reportId: data.reportId || safeId });
}