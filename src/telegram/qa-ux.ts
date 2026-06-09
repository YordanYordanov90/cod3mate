import path from 'node:path';
import { access } from 'node:fs/promises';
import { InputFile } from 'grammy';
import type { Context } from 'grammy';
import { sanitizeString } from '../security/sanitize.js';
import { chunkMessage } from './format.js';
import { formatQaReport, buildQaSessionAnnotation, type QaReport } from '../tools/qa/report.js';
import { saveQaReport } from '../storage/qa-reports.js';

const MAX_QA_SCREENSHOTS_PER_RUN = 5;

export interface ProcessAgentOptions {
  maxIterations?: number;
  /** Force QA report + screenshot collection on or off. */
  collectQaReport?: boolean;
}

/**
 * Whether to activate the QA report collector for a free-text agent task.
 * /qa-test and /qa-run pass collectQaReport: true explicitly.
 */
export function shouldCollectQaReport(
  instruction: string,
  options: ProcessAgentOptions = {}
): boolean {
  if (options.collectQaReport === true) return true;
  if (options.collectQaReport === false) return false;

  const t = instruction.toLowerCase();
  if (/\b(qa[\s_-]?test|qa report|e2e test|regression test)\b/.test(t)) {
    return true;
  }
  if (/qa_assert_[a-z0-9_]+/.test(t)) {
    return true;
  }
  if (/\b(run|execute)\b.*\bqa\b/.test(t) || /\bqa\b.*\b(scenario|flow)\b/.test(t)) {
    return true;
  }
  if (/\bscreenshot\b/.test(t) && /\bassert/.test(t)) {
    return true;
  }
  if (/\btest\b/.test(t) && /\b(assert|screenshot|playwright|browser_|qa_)\b/.test(t)) {
    return true;
  }
  return false;
}

export interface QaDeliveryResult {
  reportId?: string;
  sessionSuffix: string;
}

/**
 * Persist report, send formatted report text, and deliver queued screenshots to Telegram.
 */
export async function deliverQaArtifacts(
  ctx: Context,
  args: {
    dataDir: string;
    tmpDir: string;
    chunkSize: number;
    report: QaReport | null;
    screenshotPaths: string[];
    reportPrefix?: string;
  }
): Promise<QaDeliveryResult> {
  const { dataDir, tmpDir, chunkSize, report, screenshotPaths, reportPrefix = '' } = args;
  let reportId: string | undefined;
  let sessionSuffix = '';

  if (report && report.entries.length > 0) {
    try {
      reportId = await saveQaReport(dataDir, report, {
        tmpDir,
        tmpScreenshotPaths: screenshotPaths,
      });
    } catch (saveErr) {
      console.error('[qa] Failed to persist QA report:', saveErr);
    }
    sessionSuffix = buildQaSessionAnnotation(report, reportId);
    const formatted = reportPrefix + formatQaReport(report);
    await sendSafeText(ctx, sanitizeString(formatted), chunkSize);
  }

  if (screenshotPaths.length > 0) {
    await sendQaScreenshots(ctx, tmpDir, screenshotPaths);
  }

  const out: QaDeliveryResult = { sessionSuffix };
  if (reportId) out.reportId = reportId;
  return out;
}

async function sendQaScreenshots(
  ctx: Context,
  tmpDir: string,
  relativePaths: string[]
): Promise<void> {
  const root = path.resolve(tmpDir);
  let sent = 0;

  for (const rel of relativePaths) {
    if (sent >= MAX_QA_SCREENSHOTS_PER_RUN) break;

    const safeRel = rel.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    const full = path.resolve(root, safeRel);
    if (full !== root && !full.startsWith(root + path.sep)) {
      console.warn('[qa] screenshot path outside TMP_DIR, skipped:', rel);
      continue;
    }

    try {
      await access(full);
      await ctx.replyWithPhoto(new InputFile(full), {
        caption: sanitizeString(`QA screenshot (${safeRel})`),
      });
      sent++;
    } catch (err) {
      console.warn('[qa] Failed to send screenshot to Telegram:', safeRel, err);
    }
  }

  if (relativePaths.length > MAX_QA_SCREENSHOTS_PER_RUN) {
    await sendSafeText(
      ctx,
      sanitizeString(
        `(${relativePaths.length - MAX_QA_SCREENSHOTS_PER_RUN} more screenshot(s) saved under tmp only — Telegram limit ${MAX_QA_SCREENSHOTS_PER_RUN} per run.)`
      ),
      3500
    );
  }
}

async function sendSafeText(ctx: Context, text: string, maxChunkSize: number): Promise<void> {
  const chunks = chunkMessage(text, { maxChunkSize });
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk);
    } catch (err) {
      console.error('[telegram] Failed to send chunk:', err);
    }
  }
}
